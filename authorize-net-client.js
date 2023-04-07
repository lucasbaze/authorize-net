const ApiContracts = require("authorizenet").APIContracts;
const ApiControllers = require("authorizenet").APIControllers;
const SDKConstants = require("authorizenet").Constants;

const config = require("../../config/app");
const { getErrorByCode } = require("./errors");

const DUPLICATE_CUSTOMER_PROFILE_ERROR_CODE = "E00039";

const getAuthentication = () => {
  const merchantAuthenticationType =
    new ApiContracts.MerchantAuthenticationType();
  merchantAuthenticationType.setName(config.authorizeNetLoginId);
  merchantAuthenticationType.setTransactionKey(
    config.authorizeNetTransactionKey
  );

  return merchantAuthenticationType;
};

const executeRequest = (ctrl) => {
  ctrl.setEnvironment(
    config.authorizeNetEnvironment === "sandbox" ||
      !config.authorizeNetEnvironment
      ? SDKConstants.endpoint.sandbox
      : SDKConstants.endpoint.production
  );

  return new Promise((resolve) => {
    ctrl.execute(() => {
      const apiResponse = ctrl.getResponse();
      return resolve(apiResponse);
    });
  });
};

const getResponseOrThrow = (response) => {
  if (!response) {
    throw new Error("Empty response from authorize.net");
  }
  if (
    response.getMessages().getResultCode() !== ApiContracts.MessageTypeEnum.OK
  ) {
    if (
      response.getTransactionResponse &&
      response.getTransactionResponse() != null &&
      response.getTransactionResponse().getErrors() != null
    ) {
      throw new Error(
        response
          .getTransactionResponse()
          .getErrors()
          .getError()[0]
          .getErrorText()
      );
    }
    throw new Error(response.getMessages().getMessage()[0].getText());
  }
  return response;
};

const createCustomerProfile = async (user) => {
  const customerProfileType = new ApiContracts.CustomerProfileType();
  customerProfileType.setDescription(user.id);
  customerProfileType.setEmail(user.email);

  const createRequest = new ApiContracts.CreateCustomerProfileRequest();
  createRequest.setProfile(customerProfileType);
  createRequest.setMerchantAuthentication(getAuthentication());

  const ctrl = new ApiControllers.CreateCustomerProfileController(
    createRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);

  let response = new ApiContracts.CreateCustomerProfileResponse(apiResponse);
  if (
    response.getMessages().getResultCode() ===
    ApiContracts.MessageTypeEnum.ERROR
  ) {
    const message = response.getMessages().getMessage()[0];
    if (message.getCode() === DUPLICATE_CUSTOMER_PROFILE_ERROR_CODE) {
      /** We use this to extract the id of the duplicate customer profile from the authorize.net error message
       * in case the same customer profile already exists.
       * The duplicate profile id should also be present in the response object but for some reason their API returns it only in the message
       */
      return message.getText().replace(/[^0-9]/g, "");
    }
  }
  response = getResponseOrThrow(response);

  return response.getCustomerProfileId();
};

const createPaymentProfile = async ({
  customerProfileId,
  opaqueData,
  user,
  addressLine1,
  addressLine2,
  city,
  postalCode,
  state,
}) => {
  const paymentType = new ApiContracts.PaymentType();
  paymentType.setOpaqueData(opaqueData);

  const billTo = new ApiContracts.CustomerAddressType();
  billTo.setFirstName(user.firstName);
  billTo.setLastName(user.lastName);
  billTo.setAddress(`${addressLine1} ${addressLine2}`);
  billTo.setCity(city);
  billTo.setState(state);
  billTo.setZip(postalCode);
  billTo.setCountry("USA");
  billTo.setEmail(user.email);
  billTo.setPhoneNumber(user.phoneNumber);

  const customerPaymentProfileType =
    new ApiContracts.CustomerPaymentProfileType();
  customerPaymentProfileType.setCustomerType(
    ApiContracts.CustomerTypeEnum.INDIVIDUAL
  );
  customerPaymentProfileType.setPayment(paymentType);
  customerPaymentProfileType.setBillTo(billTo);
  customerPaymentProfileType.setDefaultPaymentProfile(true);

  const paymentProfilesList = [];
  paymentProfilesList.push(customerPaymentProfileType);

  const createRequest = new ApiContracts.CreateCustomerPaymentProfileRequest();

  createRequest.setMerchantAuthentication(getAuthentication());
  createRequest.setCustomerProfileId(customerProfileId);
  createRequest.setPaymentProfile(customerPaymentProfileType);
  createRequest.setValidationMode(ApiContracts.ValidationModeEnum.NONE);

  const ctrl = new ApiControllers.CreateCustomerPaymentProfileController(
    createRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  let response = new ApiContracts.CreateCustomerPaymentProfileResponse(
    apiResponse
  );
  if (
    response.getMessages().getResultCode() ===
    ApiContracts.MessageTypeEnum.ERROR
  ) {
    const message = response.getMessages().getMessage()[0];
    if (message.getCode() === DUPLICATE_CUSTOMER_PROFILE_ERROR_CODE) {
      return response.getCustomerPaymentProfileId();
    }
  }
  response = getResponseOrThrow(response);
  return response.getCustomerPaymentProfileId();
};

const chargeCustomerProfile = async ({
  customerProfileId,
  price,
  user,
  description,
}) => {
  const profileToCharge = new ApiContracts.CustomerProfilePaymentType();
  profileToCharge.setCustomerProfileId(customerProfileId);

  const userIdField = new ApiContracts.UserField();
  userIdField.setName("User Id");
  userIdField.setValue(user.id);

  const userFieldList = [];
  userFieldList.push(userIdField);

  const userFields = new ApiContracts.TransactionRequestType.UserFields();
  userFields.setUserField(userFieldList);

  const customer = new ApiContracts.CustomerDataType();
  customer.setEmail(user.email);

  const orderDetails = new ApiContracts.OrderType();
  orderDetails.setDescription(description);

  const transactionSetting1 = new ApiContracts.SettingType();
  transactionSetting1.setSettingName("duplicateWindow");
  transactionSetting1.setSettingValue("300");

  const transactionSettingList = [];
  transactionSettingList.push(transactionSetting1);

  const transactionSettings = new ApiContracts.ArrayOfSetting();
  transactionSettings.setSetting(transactionSettingList);

  const transactionRequestType = new ApiContracts.TransactionRequestType();
  transactionRequestType.setTransactionType(
    ApiContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION
  );
  transactionRequestType.setCustomer(customer);
  transactionRequestType.setProfile(profileToCharge);
  transactionRequestType.setAmount(price / 100);
  transactionRequestType.setCurrencyCode("USD");
  transactionRequestType.setOrder(orderDetails);
  transactionRequestType.setTransactionSettings(transactionSettings);
  transactionRequestType.setUserFields(userFields);

  const createRequest = new ApiContracts.CreateTransactionRequest();
  createRequest.setMerchantAuthentication(getAuthentication());
  createRequest.setTransactionRequest(transactionRequestType);

  const ctrl = new ApiControllers.CreateTransactionController(
    createRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);

  const response = new ApiContracts.CreateTransactionResponse(apiResponse);
  const transactionResponse = response.getTransactionResponse();

  if (
    response.getMessages().getResultCode() ===
      ApiContracts.MessageTypeEnum.OK &&
    transactionResponse.getResponseCode() === "1"
  ) {
    return { transactionId: transactionResponse.getTransId() };
  }

  let error = {
    code: response.getMessages().getMessage()[0].getCode(),
    message: response.getMessages().getMessage()[0].getText(),
    level: "error",
  };
  if (transactionResponse.getErrors() != null) {
    const transactionError = transactionResponse.getErrors().getError()[0];
    error = getErrorByCode(transactionError.getErrorCode()) ?? {
      message: transactionError.getErrorText(),
      level: "error",
    };
    error = {
      ...error,
      code: transactionError.getErrorCode(),
    };
  }

  return { error };
};

const getTransactionDetails = async (transactionId) => {
  const getRequest = new ApiContracts.GetTransactionDetailsRequest();
  getRequest.setMerchantAuthentication(getAuthentication());
  getRequest.setTransId(transactionId);

  const ctrl = new ApiControllers.GetTransactionDetailsController(
    getRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  const response = getResponseOrThrow(
    new ApiContracts.GetTransactionDetailsResponse(apiResponse)
  );
  return response.getTransaction();
};

const getCustomerProfile = async (customerProfileId) => {
  const getRequest = new ApiContracts.GetCustomerProfileRequest();
  getRequest.setCustomerProfileId(customerProfileId);
  getRequest.setUnmaskExpirationDate(true);
  getRequest.setMerchantAuthentication(getAuthentication());

  const ctrl = new ApiControllers.GetCustomerProfileController(
    getRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  const response = getResponseOrThrow(
    new ApiContracts.GetCustomerProfileResponse(apiResponse)
  );

  return response.getProfile();
};

const getCustomerPaymentProfile = async (
  customerProfileId,
  customerPaymentProfileId
) => {
  const getRequest = new ApiContracts.GetCustomerPaymentProfileRequest();
  getRequest.setMerchantAuthentication(getAuthentication());
  getRequest.setCustomerProfileId(customerProfileId);
  getRequest.setCustomerPaymentProfileId(customerPaymentProfileId);

  const ctrl = new ApiControllers.GetCustomerProfileController(
    getRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  const response = getResponseOrThrow(
    new ApiContracts.GetCustomerPaymentProfileResponse(apiResponse)
  );
  return response;
};

const updateShippingAddress = async (customerProfileId, address) => {
  const profile = await getCustomerProfile(customerProfileId);

  const customerShippingAddressForUpdate =
    new ApiContracts.CustomerAddressExType();
  customerShippingAddressForUpdate.setAddress(
    `${address.addressLine1} ${address.addressLine2}`
  );
  customerShippingAddressForUpdate.setCity(address.city);
  customerShippingAddressForUpdate.setState(address.state);
  customerShippingAddressForUpdate.setZip(address.postalCode);
  customerShippingAddressForUpdate.setCountry("USA");

  if (profile.getShipToList() !== undefined) {
    const addressId = profile.getShipToList()[0].getCustomerAddressId();
    customerShippingAddressForUpdate.setCustomerAddressId(addressId);

    const updateRequest =
      new ApiContracts.UpdateCustomerShippingAddressRequest();
    updateRequest.setMerchantAuthentication(getAuthentication());
    updateRequest.setCustomerProfileId(customerProfileId);
    updateRequest.setAddress(customerShippingAddressForUpdate);

    const ctrl = new ApiControllers.UpdateCustomerShippingAddressController(
      updateRequest.getJSON()
    );
    const apiResponse = await executeRequest(ctrl);
    return getResponseOrThrow(
      new ApiContracts.UpdateCustomerShippingAddressResponse(apiResponse)
    );
  }

  const createRequest = new ApiContracts.CreateCustomerShippingAddressRequest();
  createRequest.setMerchantAuthentication(getAuthentication());
  createRequest.setCustomerProfileId(customerProfileId);
  createRequest.setAddress(customerShippingAddressForUpdate);

  const ctrl = new ApiControllers.CreateCustomerShippingAddressController(
    createRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  return getResponseOrThrow(
    new ApiContracts.CreateCustomerShippingAddressResponse(apiResponse)
  );
};

const updateCustomerProfile = async (customerProfileId, email) => {
  const customerDataForUpdate = new ApiContracts.CustomerProfileExType();
  customerDataForUpdate.setEmail(email);
  customerDataForUpdate.setCustomerProfileId(customerProfileId);

  const updateRequest = new ApiContracts.UpdateCustomerProfileRequest();
  updateRequest.setMerchantAuthentication(getAuthentication());
  updateRequest.setProfile(customerDataForUpdate);

  const ctrl = new ApiControllers.UpdateCustomerProfileController(
    updateRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  return getResponseOrThrow(
    new ApiContracts.UpdateCustomerProfileResponse(apiResponse)
  );
};

const getTransactionList = async (customerProfileId) => {
  const sorting = new ApiContracts.TransactionListSorting();
  sorting.setOrderBy(ApiContracts.TransactionListOrderFieldEnum.SUBMITTIMEUTC);
  sorting.setOrderDescending(true);

  const getRequest = new ApiContracts.GetTransactionListForCustomerRequest();
  getRequest.setMerchantAuthentication(getAuthentication());
  getRequest.setCustomerProfileId(customerProfileId);
  getRequest.setSorting(sorting);

  const ctrl = new ApiControllers.GetTransactionListForCustomerController(
    getRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  const response = getResponseOrThrow(
    new ApiContracts.GetTransactionListResponse(apiResponse)
  );

  return response.getTransactions();
};

const getPaymentHistory = async (customerProfileId) => {
  const sorting = new ApiContracts.TransactionListSorting();
  sorting.setOrderBy(ApiContracts.TransactionListOrderFieldEnum.SUBMITTIMEUTC);
  sorting.setOrderDescending(true);

  const getRequest = new ApiContracts.GetTransactionListForCustomerRequest();
  getRequest.setMerchantAuthentication(getAuthentication());
  getRequest.setCustomerProfileId(customerProfileId);
  getRequest.setSorting(sorting);

  const ctrl = new ApiControllers.GetTransactionListForCustomerController(
    getRequest.getJSON()
  );
  const apiResponse = await executeRequest(ctrl);
  const response = getResponseOrThrow(
    new ApiContracts.GetTransactionListResponse(apiResponse)
  );

  return response.getTransactions().getTransaction();
};

module.exports = {
  getAuthentication,
  createCustomerProfile,
  updateShippingAddress,
  getCustomerProfile,
  getPaymentHistory,
  getTransactionDetails,
  getTransactionList,
  chargeCustomerProfile,
  createPaymentProfile,
  getCustomerPaymentProfile,
  updateCustomerProfile,
};
