const crypto = require('crypto');
const { getCloudinaryAccountByKey, normalizeKey } = require('./cloudinaryAccounts');

function buildCloudinarySignature(params, apiSecret) {
  const signatureBase = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join('&');

  return crypto.createHash('sha1').update(`${signatureBase}${apiSecret}`).digest('hex');
}

function buildCloudinaryUploadUrl(account, resourceType = 'image') {
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(account.cloudName)}/${encodeURIComponent(resourceType)}/upload`;
}

function buildCloudinaryDestroyUrl(account, resourceType = 'image') {
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(account.cloudName)}/${encodeURIComponent(resourceType)}/destroy`;
}

async function parseCloudinaryResponse(response, contextMessage) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `${contextMessage} failed`;
    const error = new Error(message);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  if (!data) {
    throw new Error(`${contextMessage} returned an empty response`);
  }

  return data;
}

async function uploadBufferToCloudinary({
  buffer,
  filename = 'upload.png',
  accountKey,
  folder,
  resourceType = 'image',
  extraParams = {},
}) {
  const account = getCloudinaryAccountByKey(accountKey);

  if (!account) {
    throw new Error(`Unknown Cloudinary account: ${String(accountKey || '').trim()}`);
  }

  if (!account.cloudName || !account.apiKey || !account.apiSecret) {
    throw new Error(`Cloudinary account ${account.label} is missing credentials`);
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signableParams = {
    folder,
    timestamp,
    ...extraParams,
  };
  const signature = buildCloudinarySignature(signableParams, account.apiSecret);
  const formData = new FormData();

  formData.append('file', new Blob([buffer]), filename);
  formData.append('api_key', account.apiKey);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);

  if (folder) {
    formData.append('folder', folder);
  }

  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      formData.append(key, String(value));
    }
  }

  const response = await fetch(buildCloudinaryUploadUrl(account, resourceType), {
    method: 'POST',
    body: formData,
  });

  return parseCloudinaryResponse(response, 'Cloudinary upload');
}

async function destroyCloudinaryAsset({
  publicId,
  accountKey,
  resourceType = 'image',
}) {
  const normalizedPublicId = normalizeKey(publicId);
  if (!normalizedPublicId) {
    return null;
  }

  const account = getCloudinaryAccountByKey(accountKey);
  if (!account) {
    throw new Error(`Unknown Cloudinary account: ${String(accountKey || '').trim()}`);
  }

  if (!account.cloudName || !account.apiKey || !account.apiSecret) {
    throw new Error(`Cloudinary account ${account.label} is missing credentials`);
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signableParams = {
    public_id: normalizedPublicId,
    timestamp,
  };
  const signature = buildCloudinarySignature(signableParams, account.apiSecret);
  const formData = new FormData();

  formData.append('public_id', normalizedPublicId);
  formData.append('api_key', account.apiKey);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);

  const response = await fetch(buildCloudinaryDestroyUrl(account, resourceType), {
    method: 'POST',
    body: formData,
  });

  return parseCloudinaryResponse(response, 'Cloudinary delete');
}

module.exports = {
  buildCloudinarySignature,
  destroyCloudinaryAsset,
  uploadBufferToCloudinary,
};
