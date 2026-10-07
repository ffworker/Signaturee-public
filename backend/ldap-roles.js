const VALID_ATTRIBUTE = /^[a-z][a-z0-9]*$/i;

function parseLdapRoleRules(config) {
  if (!config || !Array.isArray(config.rules)) {
    throw new Error('LDAP role rules must contain a rules array.');
  }
  return config.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || rule.role !== 'it') {
      throw new Error(`LDAP role rule ${index}: role must be it (LDAP admin is forbidden).`);
    }
    const keys = Object.keys(rule);
    const isAttribute = typeof rule.attribute === 'string' && typeof rule.equals === 'string';
    const isGroup = typeof rule.groupDn === 'string';
    if (isAttribute && keys.length === 3 && VALID_ATTRIBUTE.test(rule.attribute) && rule.equals.trim()) {
      return { attribute: rule.attribute.toLowerCase(), equals: rule.equals.trim(), role: 'it' };
    }
    if (isGroup && keys.length === 2 && rule.groupDn.trim() && !/[\r\n]/.test(rule.groupDn)) {
      return { groupDn: rule.groupDn.trim(), role: 'it' };
    }
    throw new Error(`LDAP role rule ${index}: provide an attribute and equals, or a groupDn.`);
  });
}

function resolveLdapRuleRole(rules, { attributes = {}, groupDns = [] } = {}) {
  const attributeValues = Object.fromEntries(Object.entries(attributes || {})
    .map(([key, value]) => [key.toLowerCase(), value]));
  for (const rule of rules) {
    if (rule.attribute) {
      const values = Array.isArray(attributeValues[rule.attribute])
        ? attributeValues[rule.attribute] : [attributeValues[rule.attribute]];
      if (values.some((value) => String(value ?? '').trim().toLowerCase() === rule.equals.toLowerCase())) return 'it';
    } else if (Array.isArray(groupDns) && groupDns.some((dn) =>
      String(dn).trim().toLowerCase() === rule.groupDn.toLowerCase())) return 'it';
  }
  return 'selfservice';
}

module.exports = { parseLdapRoleRules, resolveLdapRuleRole };
