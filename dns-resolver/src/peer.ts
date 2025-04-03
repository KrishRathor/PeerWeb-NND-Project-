import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'

export const createNode = async () => {
  const node = await createLibp2p({
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/0"], // Auto-assign port
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
  });

  await node.start();
  console.log(`🌐 Peer started: ${node.peerId.toString()}`);

  return node;
};
