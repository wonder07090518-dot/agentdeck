import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { configureStorage } from './client';

const key = 'agentdeck';
export function installStorage() {
  configureStorage({
    async save(value) {
      const json = JSON.stringify(value);
      if (Platform.OS === 'web') localStorage.setItem(key, json);
      else await SecureStore.setItemAsync(key, json);
    },
    async clear() {
      if (Platform.OS === 'web') localStorage.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    },
  });
}
export async function loadCredentials(): Promise<{token:string;relayUrl:string} | undefined> {
  const raw = Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  if (!raw) return;
  const value: unknown = JSON.parse(raw);
  if (typeof value === 'object' && value !== null && 'token' in value && 'relayUrl' in value && typeof value.token === 'string' && typeof value.relayUrl === 'string') return {token:value.token,relayUrl:value.relayUrl};
}
