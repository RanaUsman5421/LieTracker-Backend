const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();
const updatesDir = path.join(__dirname, '..', 'updates');
const updaterConfigPaths = [
  path.join(updatesDir, 'updater.json'),
  path.join(updatesDir, 'latest.json'),
];
const supportedTargets = new Set(['windows', 'darwin', 'linux']);
const supportedArchitectures = new Set(['x86_64', 'aarch64', 'i686', 'armv7']);
const artifactNamePattern = /^[a-zA-Z0-9._ -]+\.(exe|msi|appimage|dmg|zip|tar\.gz)$/i;
const signatureNamePattern = /^[a-zA-Z0-9._ -]+\.sig$/i;

function parseVersion(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '');
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(first, second) {
  const firstParts = parseVersion(first);
  const secondParts = parseVersion(second);

  if (!firstParts || !secondParts) {
    return null;
  }

  for (let index = 0; index < 3; index += 1) {
    if (firstParts[index] > secondParts[index]) return 1;
    if (firstParts[index] < secondParts[index]) return -1;
  }

  return 0;
}

function isSafeFileName(fileName, pattern) {
  const value = String(fileName || '').trim();
  return Boolean(value)
    && pattern.test(value)
    && path.basename(value) === value
    && !value.includes('..')
    && !path.isAbsolute(value);
}

function buildPublicFileUrl(req, fileName) {
  const forwardedProtocol = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProtocol || req.protocol;
  const baseUrl = `${protocol}://${req.get('host')}${req.baseUrl}`;
  return `${baseUrl}/${encodeURIComponent(fileName)}`;
}

async function readUpdaterConfig() {
  let lastMissingError = null;

  for (const configPath of updaterConfigPaths) {
    let rawConfig;

    try {
      rawConfig = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        lastMissingError = error;
        continue;
      }
      throw error;
    }

    try {
      return JSON.parse(rawConfig);
    } catch (error) {
      const invalidError = new Error(`${path.basename(configPath)} is not valid JSON`);
      invalidError.statusCode = 500;
      throw invalidError;
    }
  }

  const missingError = new Error('Updater configuration file is missing');
  missingError.statusCode = 503;
  missingError.cause = lastMissingError;
  throw missingError;
}

function validateUpdaterConfig(config) {
  const version = String(config?.version || '').trim();
  const notes = String(config?.notes || '').trim();
  const pubDate = String(config?.pub_date || '').trim();
  const installer = String(config?.installer || '').trim();
  const signatureFile = String(config?.signatureFile || '').trim();

  if (!parseVersion(version)) {
    throw new Error('Updater configuration has an invalid version');
  }

  if (!pubDate || Number.isNaN(new Date(pubDate).getTime())) {
    throw new Error('Updater configuration has an invalid pub_date');
  }

  if (!isSafeFileName(installer, artifactNamePattern)) {
    throw new Error('Updater configuration has an invalid installer file name');
  }

  if (!isSafeFileName(signatureFile, signatureNamePattern)) {
    throw new Error('Updater configuration has an invalid signature file name');
  }

  return {
    version,
    notes,
    pubDate,
    installer,
    signatureFile,
  };
}

async function ensureReadableFile(filePath, label) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`${label} is not a file`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missingError = new Error(`${label} file is missing`);
      missingError.statusCode = 503;
      throw missingError;
    }
    throw error;
  }
}

router.get('/:target/:arch/:currentVersion', async (req, res) => {
  try {
    const target = String(req.params.target || '').trim().toLowerCase();
    const arch = String(req.params.arch || '').trim().toLowerCase();
    const currentVersion = String(req.params.currentVersion || '').trim();

    if (!supportedTargets.has(target)) {
      return res.status(400).json({ success: false, message: 'Unsupported update target' });
    }

    if (!supportedArchitectures.has(arch)) {
      return res.status(400).json({ success: false, message: 'Unsupported update architecture' });
    }

    if (!parseVersion(currentVersion)) {
      return res.status(400).json({ success: false, message: 'Invalid current version' });
    }

    const config = validateUpdaterConfig(await readUpdaterConfig());
    const versionComparison = compareVersions(config.version, currentVersion);

    if (versionComparison === null) {
      return res.status(500).json({ success: false, message: 'Unable to compare update versions' });
    }

    if (versionComparison <= 0) {
      return res.status(204).send();
    }

    const installerPath = path.join(updatesDir, config.installer);
    const signaturePath = path.join(updatesDir, config.signatureFile);

    await ensureReadableFile(installerPath, 'Updater installer');
    await ensureReadableFile(signaturePath, 'Updater signature');

    const signature = (await fs.readFile(signaturePath, 'utf8')).trim();

    if (!signature) {
      return res.status(500).json({ success: false, message: 'Updater signature file is empty' });
    }

    console.log(`[Backend] Update available for ${target}/${arch}: ${currentVersion} -> ${config.version}`);

    return res.json({
      version: config.version,
      notes: config.notes,
      pub_date: config.pubDate,
      url: buildPublicFileUrl(req, config.installer),
      signature,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error('[Backend] Update check error:', error);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? 'Unable to check for updates' : error.message,
    });
  }
});

router.use(express.static(updatesDir, {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  setHeaders(res, filePath) {
    if (/\.sig$/i.test(filePath)) {
      res.type('text/plain');
      return;
    }

    res.type('application/octet-stream');
  },
}));

module.exports = router;