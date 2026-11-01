function notFound(req, res) {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message,
    code: err.code || (status >= 500 ? 'SERVER_ERROR' : 'ERROR'),
  });
}

module.exports = { notFound, errorHandler };
