const crypto = require("crypto");

const config = require("../config/app");
const authorizeNet = require("../vendors/authorize.net/client");

const checkSignature = (req) => {
	const signature = req.headers["x-anet-signature"].toLowerCase();

	const sig = Buffer.from(signature || "", "utf8");
	const hmac = crypto.createHmac("sha512", config.authorizeNetSignature);
	const computedSignature = hmac.update(req.rawBody).digest("hex");
	const digest = Buffer.from(`sha512=${computedSignature}`, "utf8");

	return sig.length === digest.length && crypto.timingSafeEqual(digest, sig);
};

const chargeAppointment = async (user, price) => {
	const { transactionId, error } = await authorizeNet.chargeCustomerProfile({
		customerProfileId: user.authorizeNetCustomerId,
		price: price.amount,
		user,
		description: getPaymentDescription(...),
	});

	if (error) {
		return { error };
	}

	return { transactionId };
};

const exportFunctions = {
	checkSignature,
	chargeAppointment,
};

module.exports = exportFunctions;
