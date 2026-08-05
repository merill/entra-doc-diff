const TOPIC_ICON_BASE_PATH = '/assets/topics';

const SOURCE = Object.freeze({
  repository: 'https://github.com/DanielBradley1/msicons',
  revision: '3d57443ed4445be9465ee2fee6a6ce6fd02cf90c'
});

const TOPIC_ICONS = Object.freeze({
  architecture: icon('architecture.svg', 'Blueprints', 'management-governance/00006-icon-service-Blueprints.svg', 'closest'),
  standards: icon('standards.svg', 'Compliance', 'management-governance/00011-icon-service-Compliance.svg', 'closest'),
  'identity-platform': icon('identity-platform.svg', 'App Registrations', 'identity/10232-icon-service-App-Registrations.svg', 'closest'),
  fundamentals: icon('fundamentals.svg', 'Guide', 'general/10810-icon-service-Guide.svg', 'closest'),
  troubleshooting: icon('troubleshooting.svg', 'Diagnose and solve problems', 'identity/Diagnose and solve problems.svg', 'exact'),
  authentication: icon('authentication.svg', 'Multifactor Authentication', 'security/03344-icon-service-Multifactor-Authentication.svg', 'exact'),
  'conditional-access': icon('conditional-access.svg', 'Conditional Access', 'security/10233-icon-service-Conditional-Access.svg', 'exact'),
  security: icon('security.svg', 'Security', 'identity/00321-icon-service-Security.svg', 'exact'),
  governance: icon('governance.svg', 'Identity Governance', 'identity/10235-icon-service-Identity-Governance.svg', 'exact'),
  provisioning: icon('provisioning.svg', 'Entra Connect Sync', 'identity/03533-icon-service-Entra-Connect-Sync.svg', 'closest'),
  branding: icon('branding.svg', 'Image', 'general/10812-icon-service-Image.svg', 'closest'),
  monitoring: icon('monitoring.svg', 'Monitor', 'monitor/00001-icon-service-Monitor.svg', 'exact'),
  developer: icon('developer.svg', 'Code', 'general/10787-icon-service-Code.svg', 'closest'),
  general: icon('general.svg', 'Information', 'general/10005-icon-service-Information.svg', 'closest')
});

function icon(file, sourceName, sourcePath, match) {
  return Object.freeze({ file, sourceName, sourcePath, match });
}

function topicIcon(slug) {
  return TOPIC_ICONS[String(slug || '').toLowerCase()] || TOPIC_ICONS.general;
}

function topicIconPath(slug) {
  return `${TOPIC_ICON_BASE_PATH}/${topicIcon(slug).file}`;
}

module.exports = {
  SOURCE,
  TOPIC_ICONS,
  TOPIC_ICON_BASE_PATH,
  topicIcon,
  topicIconPath
};
