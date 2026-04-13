window.APP_CONFIG = (() => {
  const host = String(location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const isStaging = host.includes('staging');

  return {
    API_BASE_URL: isLocal
      ? 'http://localhost:3000'
      : (isStaging
          ? 'https://liga-backend-staging.onrender.com'
          : 'https://liga-backend-tt82.onrender.com')
  };
})();
