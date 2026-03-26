const crypto = require('crypto');
function generateVAPIDKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const pub = publicKey.export({ type: 'spki', format: 'der' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' });
  // The VAPID public key starts at offset 27 in SPKI format
  const pubKeyB64 = pub.slice(27).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // The VAPID private key starts at offset 36 in PKCS8 format
  const privKeyB64 = priv.slice(36, 68).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  console.log('PUBLIC:', pubKeyB64);
  console.log('PRIVATE:', privKeyB64);
}
generateVAPIDKeys();
