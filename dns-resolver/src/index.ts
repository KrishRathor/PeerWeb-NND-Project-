import dgram from 'dgram';
import dns from 'dns';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { createHash } from 'crypto';

const LOCAL_DNS_PORT = 3000;
const REDIS_HOST = 'redis-server';
const REDIS_PORT = 6379;

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

const server = dgram.createSocket('udp4');

const hashToFixedLength = (input: string, length = 64) => {
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.slice(0, length);
}

const extractDomainFromQuery = (msg: Buffer): string | null => {
  let domain = '';
  let offset = 12;
  while (msg[offset] !== 0) {
    const length = msg[offset];
    domain += msg.subarray(offset + 1, offset + 1 + length).toString() + '.';
    offset += length + 1;
  }
  return domain.slice(0, -1);
};

const createDnsResponse = (query: Buffer, ip: string): Buffer => {
  const response = Buffer.alloc(query.length + 16);
  query.copy(response);

  response[2] = 0x81;
  response[3] = 0x80;

  response[6] = 0x00;
  response[7] = 0x01;

  const answerStart = query.length;
  response[answerStart] = 0xc0;
  response[answerStart + 1] = 0x0c;
  response[answerStart + 2] = 0x00; // Type A (IPv4)
  response[answerStart + 3] = 0x01;
  response[answerStart + 4] = 0x00; // Class IN
  response[answerStart + 5] = 0x01;
  response[answerStart + 6] = 0x00; // TTL (short-lived)
  response[answerStart + 7] = 0x00;
  response[answerStart + 8] = 0x00;
  response[answerStart + 9] = 0x3c; // TTL 60 seconds
  response[answerStart + 10] = 0x00; // Data length (IPv4 = 4 bytes)
  response[answerStart + 11] = 0x04;

  const ipParts = ip.split('.').map(Number);
  response[answerStart + 12] = ipParts[0];
  response[answerStart + 13] = ipParts[1];
  response[answerStart + 14] = ipParts[2];
  response[answerStart + 15] = ipParts[3];

  return response.subarray(0, answerStart + 16);
};


const extractIpFromResponse = (response: Buffer): string | null => {
  let offset = 12;

  while (response[offset] !== 0) {
    offset += response[offset] + 1;
  }
  offset += 5;

  if (response[offset] !== 0xc0) {
    return null;
  }
  offset += 2;

  offset += 2; // Skip TYPE (A record = 1)
  offset += 2; // Skip CLASS (IN = 1)
  offset += 4; // Skip TTL
  offset += 2; // Skip RDLENGTH

  const ip = `${response[offset]}.${response[offset + 1]}.${response[offset + 2]}.${response[offset + 3]}`;
  return ip;
};


const printCache = async () => {
  console.log(`================ Current Cache ===================\n `)

  const keys = await redis.keys("*");
  for (const key of keys) {
    const value = await redis.get(key);
    if (!value) return;
    const hashedValue = hashToFixedLength(value);
    console.log(`  ${key} - ${hashedValue} \n`)
  }
}

server.on('message', async (msg, rinfo) => {
  console.log(`Received DNS query from ${rinfo.address}:${rinfo.port}`);

  printCache();

  const domain = extractDomainFromQuery(msg);
  if (!domain) {
    console.error('Failed to extract domain from query.');
    return;
  }
  console.log(`Querying domain: ${domain}`);

  const cachedIP = await redis.get(domain);
  const cachedhtml = await redis.get(`html-${domain}`);
  if (cachedIP) {
    console.log(`Cache hit for ${domain}: ${cachedIP}`);
    const response = createDnsResponse(msg, cachedIP);
    server.send(response, rinfo.port, rinfo.address);
    if (cachedhtml) {
      console.log(`Cache hit for ${domain} for html`);
    }
    return;
  }


  const systemResolvers = dns.getServers();
  if (systemResolvers.length === 0) {
    console.error('No system DNS resolvers found.');
    return;
  }
  const forwardDnsServer = systemResolvers[0];

  const forwardSocket = dgram.createSocket('udp4');
  forwardSocket.send(msg, 53, forwardDnsServer);

  forwardSocket.on('message', async (response) => {
    console.log(`Received DNS response from ${forwardDnsServer} for ${domain}`);

    const resolvedIp = extractIpFromResponse(response);
    console.log(response);
    console.log(resolvedIp);
    if (resolvedIp && resolvedIp !== '0.0.0.0') {
      await redis.setex(domain, 3600, resolvedIp);

    }

    try {
      const res = await fetch(`http://${domain}`);
      if (res.ok) {
        const html = await res.text();
        console.log(`Fetched HTML from ${domain}, caching it.`);
        await redis.setex(`html-${domain}`, 3600, html);
      }
    } catch (err) {
      console.error(`Failed to fetch HTML from ${domain}:`, err);
    }

    printCache();

    server.send(response, rinfo.port, rinfo.address);
    forwardSocket.close();
  });
});

server.bind(LOCAL_DNS_PORT, '0.0.0.0', () => {
  console.log(`DNS Server running on 127.0.0.1:${LOCAL_DNS_PORT}`);
  console.log('Using system DNS resolvers:', dns.getServers());
});

