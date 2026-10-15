import { NativeModule, requireNativeModule } from "expo";
import { File } from "expo-file-system";
import { Platform } from "react-native";

export interface IncomingDocumentInfo {
  uri: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

declare class IncomingDocumentInfoModule extends NativeModule {
  getInfo(uri: string): Promise<IncomingDocumentInfo>;
}

let nativeModule: IncomingDocumentInfoModule | null = null;

if (Platform.OS === "android") {
  try {
    nativeModule = requireNativeModule<IncomingDocumentInfoModule>("IncomingDocumentInfo");
  } catch {
    // Expo Go and web builds do not contain this local native module.
  }
}

function fallbackName(uri: string): string | undefined {
  try {
    const decoded = decodeURIComponent(uri);
    return decoded.split(/[/:]/).filter(Boolean).pop();
  } catch {
    return uri.split(/[/:]/).filter(Boolean).pop();
  }
}

export async function getIncomingDocumentInfo(uri: string): Promise<IncomingDocumentInfo> {
  if (nativeModule) {
    return nativeModule.getInfo(uri);
  }

  let mimeType: string | undefined;
  let size: number | undefined;
  try {
    const file = new File(uri);
    mimeType = file.type || undefined;
    size = file.size ?? undefined;
  } catch {
    // The URI can still be useful even if this runtime cannot inspect it.
  }

  return {
    uri,
    name: fallbackName(uri),
    mimeType,
    size,
  };
}
