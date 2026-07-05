// Test-Umgebungsvariablen setzen, BEVOR Module geladen werden (jest setupFiles)
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';

// Dummy-Werte, damit keine echten Verbindungen versucht werden
process.env.DB_SERVER = 'localhost';
process.env.DB_DATABASE = 'testdb';
process.env.DB_USERNAME = 'testuser';
process.env.DB_PASSWORD = 'testpassword';
process.env.EMAIL_HOST = 'localhost';
process.env.EMAIL_PORT = '587';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpassword';
process.env.KET_EMAIL = 'ket@example.com';
