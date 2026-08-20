export const MAIL_INBOUND_PORTS = Object.freeze([25, 587, 993]);

export function demoInboundMailReadiness() {
  return {
    scope: 'demo',
    checkedAt: new Date().toISOString(),
    externalReachability: 'unverified',
    ports: MAIL_INBOUND_PORTS.map((port) => ({ port, status: 'unknown', source: 'demo', detail: 'Demo mode does not inspect a host firewall.' }))
  };
}

export function buildMailPortPlan({ outboundMode, outbound, inbound }) {
  const requiredOutboundPort = outboundMode === 'direct' ? 25 : outboundMode === 'relay-587' ? 587 : outboundMode === 'relay-2525' ? 2525 : null;
  if (!requiredOutboundPort) throw new Error('Outbound mail mode is invalid.');
  if (!Array.isArray(outbound?.ports) || !outbound.ports.some((item) => Number(item?.port) === requiredOutboundPort && item.status === 'open')) {
    throw new Error(`Outbound SMTP port ${requiredOutboundPort} is not confirmed open. Run the mail readiness check again.`);
  }
  const allowed = (port) => Array.isArray(inbound?.ports) && inbound.ports.some((item) => Number(item?.port) === port && item.status === 'allowed');
  const smtp = allowed(25);
  const submission = allowed(587);
  const imaps = allowed(993);
  return {
    outboundPort: requiredOutboundPort,
    inbound: { smtp, submission, imaps },
    needsPublicCertificate: smtp || submission || imaps,
    externalReachability: inbound?.externalReachability === 'verified' ? 'verified' : 'unverified',
    disabledPorts: MAIL_INBOUND_PORTS.filter((port) => !allowed(port))
  };
}

export function renderPostfixMain({ hostname, domains, outboundMode, relay, plan, certificate = null, vmail = { uid: 5000, gid: 5000 } }) {
  const lines = [
    '# Managed by Dashboard Portal. Do not edit.',
    'compatibility_level = 3.6',
    `myhostname = ${hostname}`,
    'myorigin = /etc/mailname',
    'mydestination = localhost',
    `inet_interfaces = ${plan.inbound.smtp || plan.inbound.submission ? 'all' : 'loopback-only'}`,
    'inet_protocols = all',
    'mynetworks = 127.0.0.0/8 [::1]/128',
    'smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination',
    'smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination',
    'smtpd_sasl_type = dovecot',
    'smtpd_sasl_path = private/auth',
    'smtpd_sasl_auth_enable = yes',
    'smtpd_sasl_security_options = noanonymous',
    'virtual_mailbox_domains = hash:/etc/postfix/hostmgr/domains',
    'virtual_mailbox_maps = hash:/etc/postfix/hostmgr/mailboxes',
    'virtual_mailbox_base = /var/vmail',
    `virtual_uid_maps = static:${vmail.uid}`,
    `virtual_gid_maps = static:${vmail.gid}`,
    'virtual_transport = lmtp:unix:private/dovecot-lmtp',
    'smtpd_milters = inet:127.0.0.1:8891',
    'non_smtpd_milters = inet:127.0.0.1:8891',
    'milter_default_action = accept',
    `smtp_tls_security_level = ${outboundMode === 'direct' ? 'may' : 'encrypt'}`
  ];
  if (certificate) {
    lines.push(`smtpd_tls_cert_file = ${certificate.fullchain}`, `smtpd_tls_key_file = ${certificate.privateKey}`, 'smtpd_tls_security_level = may');
  }
  if (outboundMode === 'direct') lines.push('relayhost =');
  else lines.push(
    `relayhost = [${relay.host}]:${relay.port}`,
    'smtp_sasl_auth_enable = yes',
    'smtp_sasl_password_maps = hash:/etc/hostmgr/mail/sasl_passwd',
    'smtp_sasl_security_options = noanonymous'
  );
  // Keep the intended recipient domains visible in the owned file as an audit
  // aid, while Postfix itself reads the hash map above.
  lines.push(`# Virtual domains: ${domains.join(', ')}`, '');
  return lines.join('\n');
}

export function renderPostfixMaster(plan) {
  const lines = ['# Managed by Dashboard Portal. Do not edit.'];
  if (plan.inbound.smtp) lines.push('smtp      inet  n       -       y       -       -       smtpd');
  // Direct egress and the Portal's local SMTP test do not require exposing
  // inbound SMTP. Keep this listener on loopback when public port 25 is not
  // permitted; it is deliberately not the public `smtp inet` service.
  else lines.push('127.0.0.1:25 inet n       -       y       -       -       smtpd');
  if (plan.inbound.submission) lines.push(
    'submission inet n       -       y       -       -       smtpd',
    '  -o syslog_name=postfix/submission',
    '  -o smtpd_tls_security_level=encrypt',
    '  -o smtpd_sasl_auth_enable=yes',
    '  -o smtpd_client_restrictions=permit_sasl_authenticated,reject'
  );
  lines.push(
    'pickup    unix  n       -       y       60      1       pickup',
    'cleanup   unix  n       -       y       -       0       cleanup',
    'qmgr      unix  n       -       n       300     1       qmgr',
    'tlsmgr    unix  -       -       y       1000?   1       tlsmgr',
    'rewrite   unix  -       -       y       -       -       trivial-rewrite',
    'bounce    unix  -       -       y       -       0       bounce',
    'defer     unix  -       -       y       -       0       bounce',
    'trace     unix  -       -       y       -       0       bounce',
    'verify    unix  -       -       y       -       1       verify',
    'flush     unix  n       -       y       1000?   0       flush',
    'proxymap  unix  -       -       n       -       -       proxymap',
    'proxywrite unix -       -       n       -       1       proxymap',
    'smtp      unix  -       -       y       -       -       smtp',
    'relay     unix  -       -       y       -       -       smtp',
    'showq     unix  n       -       y       -       -       showq',
    'error     unix  -       -       y       -       -       error',
    'retry     unix  -       -       y       -       -       error',
    'discard   unix  -       -       y       -       -       discard',
    'local     unix  -       n       n       -       -       local',
    'virtual   unix  -       n       n       -       -       virtual',
    'lmtp      unix  -       -       y       -       -       lmtp',
    'anvil     unix  -       -       y       -       1       anvil',
    'scache    unix  -       -       y       -       1       scache',
    ''
  );
  return lines.join('\n');
}

export function renderDovecotConfiguration({ plan, certificate = null, vmail = { uid: 5000, gid: 5000 } }) {
  const listen = plan.inbound.imaps ? '*': '127.0.0.1';
  const tls = certificate
    ? `ssl = required\nssl_cert = <${certificate.fullchain}\nssl_key = <${certificate.privateKey}`
    : 'ssl = no';
  return `# Managed by Dashboard Portal. Do not edit.
protocols = imap lmtp
listen = ${listen}
${tls}
mail_location = maildir:/var/vmail/%d/%n/Maildir
first_valid_uid = ${vmail.uid}
last_valid_uid = ${vmail.uid}
auth_mechanisms = plain login
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/hostmgr/mail/users
}
userdb {
  driver = static
  args = uid=${vmail.uid} gid=${vmail.gid} home=/var/vmail/%d/%n
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
`;
}

export function renderOpenDkimConfiguration() {
  return `# Managed by Dashboard Portal. Do not edit.
Syslog                  yes
UMask                   007
Mode                    sv
Canonicalization        relaxed/simple
Socket                  inet:8891@127.0.0.1
KeyTable                refile:/etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
ExternalIgnoreList      refile:/etc/opendkim/TrustedHosts
InternalHosts           refile:/etc/opendkim/TrustedHosts
`;
}

export function renderDkimTables(domains) {
  const active = domains.map((domain) => ({ domain: domain.domain, selector: domain.dkim?.selectors?.find((item) => item.state === 'active') ?? domain.dkim?.selectors?.[0] })).filter((item) => item.selector);
  return {
    keyTable: active.map(({ domain, selector }) => `${selector.selector}._domainkey.${domain} ${domain}:${selector.selector}:/etc/opendkim/keys/${domain}/${selector.selector}.private`).join('\n') + (active.length ? '\n' : ''),
    signingTable: active.map(({ domain, selector }) => `*@${domain} ${selector.selector}._domainkey.${domain}`).join('\n') + (active.length ? '\n' : ''),
    trustedHosts: ['127.0.0.1', '::1', ...active.map(({ domain }) => domain)].join('\n') + '\n'
  };
}

export function renderMap(entries) {
  return [...new Set(entries)].sort((left, right) => left.localeCompare(right)).join('\n') + (entries.length ? '\n' : '');
}
