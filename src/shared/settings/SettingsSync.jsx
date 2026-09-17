// src/shared/settings/SettingsSync.jsx
//
// Mounts the account-settings sync for as long as somebody is signed in.
// Renders nothing.

import { useEffect } from 'react';
import { useAuth } from '../../core/auth/AuthContext';
import { startSettingsSync, stopSettingsSync } from './syncedSettings';

export default function SettingsSync() {
  const { user } = useAuth();
  const id = user?.id || null;

  useEffect(() => {
    if (!id) return undefined;
    startSettingsSync(id);
    return () => stopSettingsSync();
  }, [id]);

  return null;
}
