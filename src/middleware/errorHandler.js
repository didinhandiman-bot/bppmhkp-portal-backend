import { AppError } from '../errors/appError.js';


const errorHandler = (err, req, res, next) => {
  // Default
  let statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  let errorDetails = undefined;

  // If it's our custom AppError, no extra details needed
  if (!(err instanceof AppError)) {
    // For non-AppError (unexpected errors), show stack in development only
    errorDetails = process.env.NODE_ENV === 'development' ? err.stack : undefined;
    if (statusCode === 500) {
      console.error('Unhandled Error:', err);
    }
  }

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(errorDetails && { error: errorDetails }),
  });
};

export default errorHandler;
