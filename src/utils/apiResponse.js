export function sendResponse(res, statusCode, message, data = null, meta = null) {
  const response = {
    success: true,
    message: message,
    data: data,
  };

  if (meta) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
}
