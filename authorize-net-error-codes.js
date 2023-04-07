const TRANSACTION_ERROR_CODES = [
  {
    code: [11],
    level: "info",
    message:
      "A duplicate transaction has been submitted. Please use a different payment method or try again in 5 minutes.",
  },
  {
    code: [2, 3, 4, 41, 44, 45, 65, 165, 191, 250, 251, 254],
    level: "info",
    message:
      "This transaction has been declined. Please try again with a different credit card.",
  },
  {
    code: [252, 253],
    level: "error",
    message:
      "The transaction was accepted, but is being held for review. Please wait until your transaction is approved or rejected.",
  },
  {
    code: [27],
    level: "warn",
    message:
      "Please check your payment details again. The transaction was declined because of incorrect details.",
  },
  {
    code: [6, 37, 315],
    level: "info",
    message: "The credit card number is invalid.",
  },
  {
    code: [8, 317],
    level: "info",
    message: "The credit card has expired.",
  },
];

const ERROR_CODES_MAP = [];
for (const error of TRANSACTION_ERROR_CODES) {
  for (const code of error.code) {
    ERROR_CODES_MAP[code] = error;
  }
}

const getErrorByCode = (code) => ERROR_CODES_MAP[code];

module.exports = {
  getErrorByCode,
};
