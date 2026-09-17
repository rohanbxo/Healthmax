-- Separate database for the ts-mocha suite (DATABASE_URL_TEST).
SELECT 'CREATE DATABASE beta_test OWNER beta'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'beta_test')\gexec
