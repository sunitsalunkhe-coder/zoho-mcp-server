import dotenv from 'dotenv';

dotenv.config();

/**
 * Production (EC2): set USE_SSM=true — fetches the entire .env content
 * stored as a single SecureString at SSM_PATH + "env", parses it into
 * process.env. No secrets ever sit in a file on the server.
 *
 * SSM param: /nfc/backend/env  → entire .env file content (SecureString)
 */
export async function loadConfig() {
  if (process.env.USE_SSM !== 'true') {
    console.log('🔧 Config: using local .env (USE_SSM not set)');
    return;
  }

  const path = process.env.SSM_PATH || '/nfc/backend/';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const paramName = `${path}env`;

  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({ region });

  const res = await ssm.send(new GetParameterCommand({
    Name: paramName,
    WithDecryption: true,
  }));

  const content = res.Parameter!.Value!;
  let count = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) {
      process.env[key] = value;
      count++;
    }
  }

  console.log(`🔐 Config: loaded ${count} variable(s) from SSM ${paramName} (${region})`);
}
