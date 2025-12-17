import { body, validationResult } from "express-validator";

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array()
    });
  }
  next();
};

export const validateCoinTap = [
  body('coinIndex')
    .isInt({ min: 0, max: 4 })
    .withMessage('Coin index must be between 0 and 4'),
  handleValidationErrors
];