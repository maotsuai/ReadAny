import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

export interface InsecureNetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64?: string;
}

declare class InsecureNetworkModule extends NativeModule {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    bodyBase64: string | null,
    timeoutMs: number,
  ): Promise<InsecureNetworkResponse>;
  uploadFile(
    url: string,
    filePath: string,
    method: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<InsecureNetworkResponse>;
  downloadFile(
    url: string,
    filePath: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<InsecureNetworkResponse>;
}

let nativeModule: InsecureNetworkModule | null = null;

if (Platform.OS === "ios" || Platform.OS === "android") {
  try {
    nativeModule = requireNativeModule<InsecureNetworkModule>("InsecureNetwork");
  } catch {
    // Expo Go and an old dev client do not contain local native modules.
  }
}

export function isInsecureNetworkAvailable(): boolean {
  return nativeModule !== null;
}

export default nativeModule;
