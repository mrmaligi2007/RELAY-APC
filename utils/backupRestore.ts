import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import DataStore from './DataStore';

// Keys used in AsyncStorage
const BACKUP_KEYS = {
  DEVICES_STORAGE_KEY: 'gsm_devices',
  ACTIVE_DEVICE_KEY: 'active_device_id',
  LEGACY_LOGS_KEY: 'app_logs',
  LEGACY_USERS_KEY: 'authorizedUsers',
  SYSTEM_LOGS_KEY: 'systemLogs',
  SMS_COMMAND_LOGS_KEY: 'smsCommandLogs',
  SETTINGS_KEY: 'app_settings',
};

// Interface for backup data structure
interface BackupData {
  version: string;
  timestamp: string;
  data: {
    [key: string]: any;
  };
}

/**
 * Creates a backup of all app data
 * @returns The backup data as a JSON string
 */
export const createBackup = async (): Promise<string> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    console.log('Creating backup for keys:', allKeys);
    const keyValuePairs = await AsyncStorage.multiGet(allKeys);
    
    // Create a simple backup object - direct key-value storage
    const backupData = {};
    
    keyValuePairs.forEach(([key, value]) => {
      if (value) {
        try {
          backupData[key] = JSON.parse(value);
        } catch {
          backupData[key] = value;
        }
      }
    });
    
    return JSON.stringify(backupData);
  } catch (error) {
    console.error('Backup creation error:', error);
    throw error;
  }
};

/**
 * Saves backup data to a file with today's date
 */
export const saveBackupToFile = async (): Promise<string> => {
  try {
    // Create backup data
    const backupData = await createBackup();
    
    // Generate filename with current date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const fileName = `gsm-opener-backup-${dateStr}.json`;
    
    // Determine file path
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    
    // Write backup data to file
    await FileSystem.writeAsStringAsync(filePath, backupData);
    
    return filePath;
  } catch (error) {
    console.error('Failed to save backup to file:', error);
    throw error;
  }
};

/**
 * Share the backup file with the user
 */
export const shareBackup = async (): Promise<void> => {
  try {
    // Create and save backup file
    const backupFilePath = await saveBackupToFile();
    
    // Check if sharing is available
    const isSharingAvailable = await Sharing.isAvailableAsync();
    
    if (isSharingAvailable) {
      // Share the file
      await Sharing.shareAsync(backupFilePath, {
        mimeType: 'application/json',
        dialogTitle: 'Save GSM Opener Backup',
        UTI: 'public.json' // For iOS
      });
    } else {
      throw new Error('Sharing is not available on this device');
    }
  } catch (error) {
    console.error('Failed to share backup:', error);
    throw error;
  }
};

/**
 * Restores app data from a backup file - ultra basic version
 */
export const restoreFromBackup = async (backupJson: string): Promise<boolean> => {
  try {
    console.log(`RESTORE: Content length=${backupJson?.length || 0}`);
    
    if (!backupJson) {
      console.error('RESTORE: Empty content provided');
      throw new Error('Backup file appears to be empty');
    }
    
    // Prepare content for parsing - handle common issues
    let processedContent = backupJson.trim();
    
    // Find the valid JSON start (more aggressive approach)
    const jsonStartOptions = [
      processedContent.indexOf('{"'),  // Standard JSON object start
      processedContent.indexOf('{\n"'), // JSON with newline
      processedContent.indexOf('{ "'),  // JSON with space
      processedContent.lastIndexOf('{"'),  // Try finding the last occurrence too
    ].filter(pos => pos >= 0);
    
    const jsonStart = jsonStartOptions.length > 0 ? Math.min(...jsonStartOptions) : -1;
    
    if (jsonStart > 0) {
      processedContent = processedContent.substring(jsonStart);
      console.log(`RESTORE: Fixed starting position, removed ${jsonStart} chars`);
    }
    
    // Fix potential trailing issues - find a balanced closing brace
    let braceCount = 0;
    let lastValidPos = 0;
    
    // Simple brace balancing to find the end of JSON
    for (let i = 0; i < processedContent.length; i++) {
      const char = processedContent[i];
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) lastValidPos = i + 1;
      }
    }
    
    if (lastValidPos > 0 && lastValidPos < processedContent.length) {
      processedContent = processedContent.substring(0, lastValidPos);
      console.log(`RESTORE: Trimmed to balanced JSON ending at position ${lastValidPos}`);
    }
    
    // Validate basic JSON structure
    console.log('RESTORE: Cleaned content preview:', processedContent.substring(0, Math.min(50, processedContent.length)));
    
    // PARSE STEP - Use a more robust approach
    let parsedData;
    try {
      // Regular parsing first
      parsedData = JSON.parse(processedContent);
      console.log('RESTORE: JSON parsing succeeded');
    } catch (parseError) {
      console.error('RESTORE: JSON parse error -', parseError.message);
      
      // Try manual repair of common JSON issues
      try {
        console.log('RESTORE: Attempting to repair malformed JSON');
        
        // Replace common JSON errors
        let fixedJson = processedContent
          .replace(/,\s*}/g, '}')     // Remove trailing commas in objects
          .replace(/,\s*]/g, ']');    // Remove trailing commas in arrays
          
        parsedData = JSON.parse(fixedJson);
        console.log('RESTORE: JSON repair successful');
      } catch (repairError) {
        console.error('RESTORE: JSON repair failed:', repairError.message);
        
        // Last resort - try to parse individual keys
        console.log('RESTORE: Attempting direct key extraction');
        try {
          // Create a simple object from key patterns
          const extractedData = {};
          const keyValueRegex = /"([^"]+)"\s*:\s*("(?:\\.|[^"\\])*"|[0-9]+|true|false|null|\{[^}]*\}|\[[^\]]*\])/g;
          let match;
          
          while ((match = keyValueRegex.exec(processedContent)) !== null) {
            try {
              const key = match[1];
              const value = match[2];
              extractedData[key] = JSON.parse(value);
            } catch (e) {
              // Skip this match if we can't parse it
            }
          }
          
          if (Object.keys(extractedData).length > 0) {
            parsedData = extractedData;
            console.log(`RESTORE: Extracted ${Object.keys(extractedData).length} key-value pairs directly`);
          } else {
            throw new Error('No valid key-value pairs found');
          }
        } catch (extractionError) {
          throw new Error('Could not parse backup file - invalid JSON format');
        }
      }
    }
    
    let dataToStore = {};
    
    if (parsedData && parsedData.data && typeof parsedData.data === 'object') {
      console.log('RESTORE: Found nested data property');
      dataToStore = parsedData.data;
    } else if (typeof parsedData === 'object' && !Array.isArray(parsedData)) {
      console.log('RESTORE: Using direct object format');
      dataToStore = parsedData;
    } else if (Array.isArray(parsedData)) {
      console.log('RESTORE: Found array data');
      dataToStore = { 'gsm_devices': parsedData };
    } else {
      throw new Error('Unsupported backup format');
    }
    
    // Cache existing app_data before clearing if it exists
    let existingAppData = null;
    try {
      const appDataString = await AsyncStorage.getItem('app_data');
      if (appDataString) {
        existingAppData = JSON.parse(appDataString);
        console.log('RESTORE: Cached existing app_data for potential merge');
      }
    } catch (e) {
      console.warn('RESTORE: Error reading existing app_data:', e);
    }
    
    // Special handling for logs - cache these as they're complex objects that need special care
    const cachedLogs = {};
    for (const [key, value] of Object.entries(dataToStore)) {
      // Look for log keys which typically have "logs" in their name
      if (key.includes('logs') || key === 'app_data') {
        try {
          // If this is the main app_data, extract just the logs part
          if (key === 'app_data' && value && typeof value === 'object' && value.logs) {
            cachedLogs['app_logs'] = value.logs;
            console.log('RESTORE: Found logs in app_data, caching separately');
          } else {
            cachedLogs[key] = value;
          }
        } catch (e) {
          console.warn(`RESTORE: Failed to cache logs for key ${key}:`, e);
        }
      }
    }
    
    // Handle conflicts - mainly regarding device data
    // If there's app_data in the backup and existing app_data, special handling needed
    if (dataToStore['app_data'] && existingAppData) {
      try {
        const backupAppData = dataToStore['app_data'];
        
        // Check if we should merge device data
        if (backupAppData.devices && existingAppData.devices) {
          console.log('RESTORE: Attempting to merge device data');
          
          // Keep track of device IDs in existing data
          const existingDeviceIds = new Set(existingAppData.devices.map(d => d.id));
          
          // Merge in devices that don't already exist
          for (const backupDevice of backupAppData.devices) {
            if (!existingDeviceIds.has(backupDevice.id)) {
              console.log(`RESTORE: Adding new device from backup: ${backupDevice.name}`);
              existingAppData.devices.push(backupDevice);
            } else {
              console.log(`RESTORE: Device already exists, skipping: ${backupDevice.name}`);
            }
          }
          
          // Update the backup data to use our merged device list
          backupAppData.devices = existingAppData.devices;
          
          // Merge logs from existing app_data
          if (existingAppData.logs) {
            for (const [deviceId, logEntries] of Object.entries(existingAppData.logs)) {
              if (!backupAppData.logs[deviceId]) {
                backupAppData.logs[deviceId] = logEntries;
                console.log(`RESTORE: Preserved logs for device ${deviceId}`);
              } else {
                // Merge log entries by ID to avoid duplicates
                const existingLogIds = new Set(logEntries.map(entry => entry.id));
                const newLogs = backupAppData.logs[deviceId].filter(entry => !existingLogIds.has(entry.id));
                backupAppData.logs[deviceId] = [...newLogs, ...logEntries];
                console.log(`RESTORE: Merged ${newLogs.length} new logs with ${logEntries.length} existing logs for device ${deviceId}`);
              }
            }
          }
          
          // Update the dataToStore with our merged app_data
          dataToStore['app_data'] = backupAppData;
        }
      } catch (mergeError) {
        console.error('RESTORE: Error merging app_data:', mergeError);
        // Continue with original data if merge fails
      }
    }
    
    // Clear existing data (except for the data we want to preserve)
    try {
      // Get a list of all keys except those we want to preserve
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter(key => {
        // Don't remove app_data if we've merged it
        if (key === 'app_data' && dataToStore['app_data'] && existingAppData) {
          return false;
        }
        return true;
      });
      
      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
        console.log(`RESTORE: Cleared ${keysToRemove.length} existing keys`);
      }
    } catch (clearError) {
      console.warn('RESTORE: Error clearing data:', clearError);
    }
    
    // Save each item
    let successCount = 0;
    for (const [key, value] of Object.entries(dataToStore)) {
      try {
        if (value === null || value === undefined) continue;
        
        // Convert to string as needed
        const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
        await AsyncStorage.setItem(key, valueToStore);
        successCount++;
      } catch (itemError) {
        console.error(`RESTORE: Failed to restore ${key}:`, itemError);
      }
    }
    
    // Now restore logs from our cache
    try {
      if (Object.keys(cachedLogs).length > 0) {
        console.log(`RESTORE: Restoring cached logs for ${Object.keys(cachedLogs).length} keys`);
        
        // Restore each log collection we cached
        for (const [logKey, logValue] of Object.entries(cachedLogs)) {
          console.log(`RESTORE: Restoring logs for ${logKey}`);
          // Skip if already stored with the main data
          if (dataToStore[logKey]) continue;
          
          const logValueToStore = typeof logValue === 'string' ? logValue : JSON.stringify(logValue);
          await AsyncStorage.setItem(logKey, logValueToStore);
          successCount++;
        }
      }
    } catch (logRestoreError) {
      console.error('RESTORE: Error restoring logs:', logRestoreError);
    }
    
    if (successCount === 0) {
      throw new Error('Failed to restore any items');
    }

    // Force DataStore to reinitialize after restore
    try {
      // Reset DataStore's initialization state
      const dataStore = DataStore.getInstance();
      await dataStore.forceReinitialization();
      console.log('RESTORE: DataStore reinitialized successfully');
    } catch (reinitError) {
      console.error('RESTORE: Error reinitializing DataStore:', reinitError);
      // Continue anyway, as the main restore succeeded
    }
    
    console.log(`RESTORE: Successfully restored ${successCount}/${Object.keys(dataToStore).length} items`);
    return true;
  } catch (error) {
    console.error('RESTORE FAILED:', error);
    throw error;
  }
};

// Simple UUID generator for backup operations
const generateSimpleUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Pick a backup file from device storage and restore it
 */
export const pickAndRestoreBackup = async (): Promise<boolean> => {
  try {
    // Pick a JSON file
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true
    });
    
    if (result.canceled) {
      return false;
    }
    
    // Get the file URI
    const fileUri = result.assets?.[0]?.uri || (result as any).uri;
    
    if (!fileUri) {
      throw new Error('Could not retrieve file URI');
    }
    
    // Read the file content
    const fileContent = await FileSystem.readAsStringAsync(fileUri);
    
    // Restore from the backup
    return await restoreFromBackup(fileContent);
  } catch (error) {
    console.error('Failed to pick and restore backup:', error);
    throw error;
  }
};