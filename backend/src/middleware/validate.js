// backend/src/middleware/validate.js
function makeBodyValidator(rules, options = {}) {
  const {
    abortEarly = false, // si true, corta en el primer error
    statusCode = 400,
  } = options;

  return function bodyValidator(req, res, next) {
    const body = req.body || {};
    const errors = [];

    for (const rule of rules) {
      const { field, required, type, enum: enumValues, regex, message } = rule;
      const value = body[field];

      // requerido
      if (required && (value === undefined || value === null || value === '')) {
        const msg = message || `El campo "${field}" es obligatorio`;
        errors.push({ field, msg });
        if (abortEarly) break;
        continue;
      }

      // si no es requerido y no vino, seguimos
      if (value === undefined || value === null) continue;

      // tipo
      if (type) {
        if (type === 'array') {
          if (!Array.isArray(value)) {
            errors.push({ field, msg: message || `El campo "${field}" debe ser un array` });
            if (abortEarly) break;
            continue;
          }
        } else if (typeof value !== type) {
          errors.push({ field, msg: message || `El campo "${field}" debe ser de tipo ${type}` });
          if (abortEarly) break;
          continue;
        }
      }

      // enum
      if (enumValues && !enumValues.includes(value)) {
        errors.push({
          field,
          msg: message || `El campo "${field}" debe ser uno de: ${enumValues.join(', ')}`,
        });
        if (abortEarly) break;
        continue;
      }

      // regex
      if (regex && typeof value === 'string' && !regex.test(value)) {
        errors.push({
          field,
          msg: message || `Formato inválido en el campo "${field}"`,
        });
        if (abortEarly) break;
        continue;
      }
    }

    if (errors.length > 0) {
      return res.status(statusCode).json({
        ok: false,
        errors,
      });
    }

    return next();
  };
}

module.exports = {
  makeBodyValidator,
};