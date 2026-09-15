// El entorno reutilizable de CI inyecta REDIS_URL para todos los servicios.
// Media exige una fuente JWKS cuando Redis habilita comandos asíncronos; esta
// URL sólo permite importar y probar módulos sin contactar a Collab.
process.env.COLLAB_JWKS_URI ??= "http://127.0.0.1:3001/.well-known/jwks.json";
process.env.MAIL_TRANSPORT ??= "log";
