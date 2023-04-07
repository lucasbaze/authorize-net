const response = require("../helpers/response");
const db = require("../models");
const { ERROR_CODES } = require("../helpers/errorCodes");
const logger = require("../config/winston");
const { wonderCalmDepositDescription } = require("../helpers/constants");
const payments = require("../payments-helpers");
const authorizeNet = require("../vendors/authorize.net/client");

const createInitialPaymentIntent = async (req, res, next) => {
	try {
		const {
			opaqueData,
			addressLine1,
			addressLine2,
			city,
			postalCode,
			state,
		} = req.body;

		const user = await db.User.findOne({
			where: { id: req.session.userId },
		});

		// Implementation details for this are irrelevant.
		// You just need a price for charging the profile
		const price = await payments.getPriceForWhatever();

		if (!user.authorizeNetCustomerId) {
			const customerProfileId = await authorizeNet.createCustomerProfile(
				user
			);
			user.authorizeNetCustomerId = customerProfileId;
			await user.save();
		}

		await authorizeNet.createPaymentProfile({
			customerProfileId: user.authorizeNetCustomerId,
			opaqueData,
			user,
			addressLine1,
			addressLine2,
			city,
			postalCode,
			state,
		});

		let transactionId;
		let error;

		if (price.amount !== 0) {
			({ transactionId, error } =
				await authorizeNet.chargeCustomerProfile({
					customerProfileId: user.authorizeNetCustomerId,
					price: price.amount,
					user,
					description: payments.getPaymentDescription(
						user,
						db.AppointmentType.NEW_PATIENT
					),
				}));

			if (error) {
				logger.log(error.level, error.message, {
					userId: req.session.userId,
					error,
				});
				return response.error(res, {
					code: ERROR_CODES.PAYMENT_FAILED.code,
					message: error.message,
				});
			}
		}

		return response.success(res, null, transactionId);
	} catch (e) {
		next(e);
	}
};

const webhookHandler = async (req, res, next) => {
	if (!payments.checkSignature(req)) {
		return res.sendStatus(400);
	}

	const event = req.body;

	try {
		switch (event.eventType) {
			case "net.authorize.payment.authcapture.created":
				await handlePaymentIntentSucceeded(event.payload);
				break;
			default:
				logger.info(`Unhandled event type ${event.type}.`);
		}
		return response.success(res, null, "");
	} catch (e) {
		next(e);
	}
};

const handlePaymentIntentSucceeded = async (payload) => {
	if (payload.entityName !== "transaction") {
		return;
	}

	const transactionId = payload.id;
	const transactionDetails = await authorizeNet.getTransactionDetails(
		transactionId
	);
	const customerProfileId = transactionDetails
		.getProfile()
		.getCustomerProfileId();

	const user = await db.User.findOne({
		where: { authorizeNetCustomerId: customerProfileId },
	});

	if (!user) {
		return;
	}

	if (
		transactionDetails.getOrder().getDescription() !== undefined &&
		transactionDetails
			.getOrder()
			.getDescription()
			.includes(wonderCalmDepositDescription)
	) {
		// Do something...
	}

	// Do something...
};

const getPaymentDetails = async (req, res, next) => {
	try {
		const user = await db.User.findOne({
			where: { id: req.session.userId },
			include: [
				{
					model: db.Address,
					as: "billingAddress",
					where: { type: db.Address.BILLING },
					required: false,
				},
			],
		});

		const paymentsList = [];
		let method = {};

		if (user.authorizeNetCustomerId) {
			try {
				const transactions = await authorizeNet.getTransactionList(
					user.authorizeNetCustomerId
				);

				if (transactions) {
					for (const element of transactions.getTransaction()) {
						const transaction =
							await authorizeNet.getTransactionDetails(
								element.getTransId()
							);
						if (transaction.responseCode === 1) {
							paymentsList.push({
								description: transaction
									.getOrder()
									.getDescription(),
								date: transaction.getSubmitTimeUTC(),
								amount: transaction.getAuthAmount() * 100,
								refunded: false,
							});
						}
					}
				}

				const customerProfile = await authorizeNet.getCustomerProfile(
					user.authorizeNetCustomerId
				);
				if (customerProfile.getPaymentProfiles().length > 0) {
					const paymentProfile =
						customerProfile.getPaymentProfiles()[0];
					const card = paymentProfile.getPayment().getCreditCard();
					const date = card.expirationDate.split("-");

					method = {
						brand: card.cardType.toLowerCase(),
						expMonth: date[1],
						expYear: date[0],
						last4: card.cardNumber.substr(
							card.cardNumber.length - 4
						),
					};
				}
			} catch (err) {
				logger.error(err, { userId: req.session?.userId });
			}
		}

		// Do something...

		return response.success(res, "", responseObject);
	} catch (e) {
		next(e);
	}
};

const updateBillingInfo = async (req, res, next) => {
	try {
		const {
			opaqueData,
			addressLine1,
			addressLine2,
			city,
			postalCode,
			state,
		} = req.body;

		const user = await db.User.findOne({
			where: { id: req.session.userId },
		});

		if (!user.authorizeNetCustomerId) {
			return response.notFound(res, ERROR_CODES.NOT_FOUND, null);
		}

		// I'm not sure this is the best way to do this because Authorize.net WILL limit you to 10
		// payment profiles max and this will throw errors if the user tries to go beyond 10.
		// We've run into it in production before
		await authorizeNet.createPaymentProfile({
			customerProfileId: user.authorizeNetCustomerId,
			opaqueData,
			user,
			addressLine1,
			addressLine2,
			city,
			postalCode,
			state,
		});

		return response.success(res, null, null);
	} catch (e) {
		next(e);
	}
};

const chargeAppointment = async (req, res, next) => {
	try {
		const { appointmentType } = req.body;

		const user = await db.User.findOne({
			where: { id: req.session.userId },
		});

		// The implementation is irrelevant. You just need a price
		const price = await payments.getPriceForWhatever();

		const { transactionId, error } = await payments.chargeAppointment(
			user,
			price
		);
		if (error) {
			logger.log(error.level, error.message, {
				userId: req.session.userId,
				error,
			});
			return response.badRequest(res, {
				code: ERROR_CODES.PAYMENT_FAILED.code,
				message: error.message,
			});
		}

		return response.success(res, null, transactionId);
	} catch (e) {
		next(e);
	}
};

module.exports = {
	createInitialPaymentIntent,
	webhookHandler,
	getPaymentDetails,
	getAccountBalance,
	updateBillingInfo,
	chargeAppointment,
};
