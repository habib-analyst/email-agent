import { useCallback, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import gmailAuthService from '../services/gmailAuthService.js';
import { pickSenderName } from '../utils/senderDisplay.js';
import { saveCachedAuth } from '../utils/connectionCache.js';

/**
 * Stable Gmail auth — single source from SessionContext after first settle.
 */
export function useGmailAuth() {
  const { auth, settings, sessionReady, backendReachable, connectionsSettled } = useSession();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const isConnected = !!auth?.authenticated;
  const senderEmail = auth?.senderEmail || settings?.sender_email || '';
  const senderName = pickSenderName(auth?.senderName, settings?.sender_name, senderEmail);
  const canSend = auth?.canSend ?? isConnected;
  const canLoadTemplate = auth?.canLoadTemplate ?? isConnected;
  const authPending = !connectionsSettled && !isConnected;

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await gmailAuthService.connect();
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await gmailAuthService.disconnect();
      saveCachedAuth(null);
      window.location.reload();
    } finally {
      setDisconnecting(false);
    }
  }, []);

  return {
    isConnected,
    senderEmail,
    senderName,
    canSend,
    canLoadTemplate,
    connect,
    disconnect,
    connecting,
    disconnecting,
    sessionReady: sessionReady || backendReachable,
    authPending,
    connectionsSettled,
  };
}

export default useGmailAuth;
