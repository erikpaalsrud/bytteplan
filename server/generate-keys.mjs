import webpush from 'web-push';
import {writeFile} from 'node:fs/promises';
const keys=webpush.generateVAPIDKeys();
await writeFile(process.argv[2] || new URL('../.env',import.meta.url),`PUBLIC_ORIGIN=http://localhost:3000\nSITE_DOMAIN=localhost\nVAPID_SUBJECT=mailto:replace-with-your-email@example.com\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,{flag:'wx',mode:0o600});
console.log('Created .env without printing keys. Set VAPID_SUBJECT and PUBLIC_ORIGIN before deployment.');
