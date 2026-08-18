const ACCOUNT_ENV_PATTERN = /^CLOUDINARY_ACCOUNT_(\d+)_(CLOUD_NAME|API_KEY|API_SECRET)$/;

function normalizeKey(value) {
  return String(value || '').trim();
}

function readLegacyCloudinaryAccount() {
  const cloudName = normalizeKey(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_LEGACY_CLOUD_NAME);
  const apiKey = normalizeKey(process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_LEGACY_API_KEY);
  const apiSecret = normalizeKey(process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_LEGACY_API_SECRET);

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  return {
    key: 'legacy',
    slot: 0,
    label: 'Legacy Cloudinary',
    cloudName,
    apiKey,
    apiSecret,
    isLegacy: true,
  };
}

function readConfiguredCloudinaryAccounts() {
  const grouped = new Map();

  for (const [envKey, rawValue] of Object.entries(process.env)) {
    const match = envKey.match(ACCOUNT_ENV_PATTERN);
    if (!match) {
      continue;
    }

    const slot = Number(match[1]);
    const field = match[2];

    if (!grouped.has(slot)) {
      grouped.set(slot, {});
    }

    grouped.get(slot)[field] = normalizeKey(rawValue);
  }

  const accounts = [];

  for (const [slot, values] of Array.from(grouped.entries()).sort((first, second) => first[0] - second[0])) {
    const cloudName = normalizeKey(values.CLOUD_NAME);
    const apiKey = normalizeKey(values.API_KEY);
    const apiSecret = normalizeKey(values.API_SECRET);

    if (!cloudName && !apiKey && !apiSecret) {
      continue;
    }

    const missing = [];
    if (!cloudName) missing.push('cloud_name');
    if (!apiKey) missing.push('api_key');
    if (!apiSecret) missing.push('api_secret');

    accounts.push({
      key: String(slot),
      slot,
      label: `Cloudinary Account ${slot}`,
      cloudName,
      apiKey,
      apiSecret,
      missing,
      isLegacy: false,
    });
  }

  return accounts;
}

function getAllCloudinaryAccounts() {
  const configuredAccounts = readConfiguredCloudinaryAccounts();
  const legacyAccount = readLegacyCloudinaryAccount();

  if (legacyAccount) {
    return [legacyAccount, ...configuredAccounts];
  }

  return configuredAccounts;
}

function getAssignableCloudinaryAccounts() {
  const configuredAccounts = readConfiguredCloudinaryAccounts().filter((account) => {
    return account.cloudName && account.apiKey && account.apiSecret;
  });

  if (configuredAccounts.length > 0) {
    return configuredAccounts;
  }

  const legacyAccount = readLegacyCloudinaryAccount();
  return legacyAccount ? [legacyAccount] : [];
}

function getCloudinaryAccountKeys() {
  return getAssignableCloudinaryAccounts().map((account) => account.key);
}

function getDefaultCloudinaryAccountKey() {
  const keys = getCloudinaryAccountKeys();
  return keys[0] || null;
}

function isValidCloudinaryAccountKey(accountKey) {
  const normalizedKey = normalizeKey(accountKey);
  if (!normalizedKey) {
    return false;
  }

  return getAllCloudinaryAccounts().some((account) => account.key === normalizedKey);
}

function getCloudinaryAccountByKey(accountKey) {
  const normalizedKey = normalizeKey(accountKey);
  if (!normalizedKey) {
    return null;
  }

  return getAllCloudinaryAccounts().find((account) => account.key === normalizedKey) || null;
}

function getCloudinaryAccountStatus() {
  const accounts = getAllCloudinaryAccounts();
  const missing = accounts
    .filter((account) => account.missing && account.missing.length)
    .map((account) => ({
      key: account.key,
      label: account.label,
      missing: [...account.missing],
    }));

  return {
    accounts,
    assignableAccounts: getAssignableCloudinaryAccounts(),
    missing,
  };
}

function getCloudinaryAccountSummaries() {
  return getAssignableCloudinaryAccounts().map((account) => ({
    key: account.key,
    label: account.label,
    cloudName: account.cloudName,
    isLegacy: account.isLegacy,
  }));
}

function getLegacyCloudinaryAccountKey() {
  const legacyAccount = readLegacyCloudinaryAccount();
  return legacyAccount?.key || null;
}

module.exports = {
  getAllCloudinaryAccounts,
  getAssignableCloudinaryAccounts,
  getCloudinaryAccountByKey,
  getCloudinaryAccountKeys,
  getCloudinaryAccountStatus,
  getCloudinaryAccountSummaries,
  getDefaultCloudinaryAccountKey,
  getLegacyCloudinaryAccountKey,
  isValidCloudinaryAccountKey,
  normalizeKey,
};
