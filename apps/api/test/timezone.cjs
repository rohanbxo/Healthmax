/**
 * Runs the suite in a zone no fixture uses, so a developer machine whose offset
 * happens to match a fixture's can never make a timezone bug pass by accident.
 * Loaded through `.mocharc.json`, so `test` and `test:ci` both get it on every
 * platform. Node re-reads `TZ` when it is assigned, before any spec loads.
 */
process.env.TZ = 'America/Los_Angeles';
