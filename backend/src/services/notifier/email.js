// A deployment may supply a real transport. No provider means unavailable,
// never a simulated delivery. Keep provider credentials out of domain code.
let transport = null;
export function configureEmailTransport(provider) {
  if (provider !== null && typeof provider !== 'function') throw new TypeError('Email transport must be a function');
  transport = provider;
}
export function emailAvailable() {
  return transport !== null;
}
export async function deliverEmail(message) {
  if (!transport) throw Object.assign(new Error('Email transport unavailable'), {
    code: 'EMAIL_UNAVAILABLE'
  });
  await transport(message);
}
