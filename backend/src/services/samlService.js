let nodeSaml;
try { nodeSaml = require('@node-saml/node-saml'); } catch { nodeSaml = null; }

const { getSetting, setSettings } = require('../db/database');
const logger = require('../utils/logger');

const SETTINGS_KEY = 'saml_config';

function getSamlConfig() {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveSamlConfig(cfg) {
  setSettings({ [SETTINGS_KEY]: JSON.stringify(cfg) });
}

/**
 * Normalizza il certificato X.509: accetta con o senza header PEM.
 * node-saml v4 accetta il certificato in formato PEM oppure solo base64.
 */
function normalizeCert(cert) {
  if (!cert) return null;
  const stripped = cert.replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return stripped;
}

function createSamlInstance(cfg) {
  if (!nodeSaml) throw new Error('@node-saml/node-saml non installato');
  const { SAML } = nodeSaml;

  const callbackUrl = `${cfg.sp_base_url}/api/auth/saml/callback`;
  const issuer = cfg.sp_entity_id || `${cfg.sp_base_url}/api/auth/saml/metadata`;

  return new SAML({
    callbackUrl,
    entryPoint:               cfg.idp_sso_url,
    issuer,
    cert:                     normalizeCert(cfg.idp_cert),
    wantAuthnResponseSigned:  false,
    wantAssertionsSigned:     false,
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs:      5000,
    identifierFormat:         null,
  });
}

function getMetadataXml(cfg) {
  const saml = createSamlInstance(cfg);
  return saml.generateServiceProviderMetadata(null, null);
}

module.exports = { getSamlConfig, saveSamlConfig, createSamlInstance, getMetadataXml };
