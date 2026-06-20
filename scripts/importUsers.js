const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadEnvironment } = require('../config/env');
loadEnvironment();

const User = require('../models/User');
const { connectToDatabase } = require('../services/database');

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith('--')) {
      continue;
    }

    const key = part.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function readInputFile(filePath) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');

  if (resolvedPath.endsWith('.json')) {
    return JSON.parse(raw);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractUsername(entry) {
  if (typeof entry === 'string') {
    return entry.trim();
  }

  if (entry && typeof entry === 'object') {
    return String(entry.username || entry.userName || entry.name || '').trim();
  }

  return '';
}

function buildEmailLocalPart(username) {
  const normalized = String(username)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');

  return normalized || 'user';
}

function buildRandomEmail(username, domain) {
  const localPart = buildEmailLocalPart(username);
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${localPart}.${suffix}@${domain}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = args.file;
  const sharedPassword = args.password;
  const domain = String(args.domain || 'monitask.local').trim().toLowerCase();

  if (!inputFile || !sharedPassword) {
    console.error('Usage: npm run import-users -- --file <users.json|users.txt> --password <sharedPassword> [--domain monitask.local]');
    process.exit(1);
  }

  if (String(sharedPassword).length < 6) {
    console.error('The shared password must be at least 6 characters long.');
    process.exit(1);
  }

  const input = readInputFile(inputFile);
  if (!Array.isArray(input)) {
    console.error('The input file must contain an array in JSON, or a plain text file with one username per line.');
    process.exit(1);
  }

  await connectToDatabase();

  const seenUsernames = new Set();
  const seenEmails = new Set();

  let createdCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (const entry of input) {
    const username = extractUsername(entry);

    if (!username) {
      skippedCount += 1;
      continue;
    }

    const uniqueKey = username.toLowerCase();
    if (seenUsernames.has(uniqueKey)) {
      skippedCount += 1;
      continue;
    }
    seenUsernames.add(uniqueKey);

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      skippedCount += 1;
      continue;
    }

    let email = '';
    do {
      email = buildRandomEmail(username, domain);
    } while (seenEmails.has(email) || await User.findOne({ email }));
    seenEmails.add(email);

    try {
      const user = new User({
        username,
        email,
        password: String(sharedPassword),
        department: '',
        designation: '',
      });

      await user.save();
      createdCount += 1;
      console.log(`Created: ${username} -> ${email}`);
    } catch (error) {
      errors.push({ username, message: error.message });
    }
  }

  console.log(`Import finished. Created: ${createdCount}, skipped: ${skippedCount}, failed: ${errors.length}`);

  if (errors.length) {
    for (const error of errors) {
      console.error(`Failed: ${error.username} -> ${error.message}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const mongoose = require('mongoose');
      await mongoose.connection.close();
    } catch (error) {
      // Ignore shutdown errors so the real import result remains visible.
    }
  });
