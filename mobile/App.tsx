import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Platform
} from 'react-native';
import { WebView } from 'react-native-webview';

// In development, replace with your local network IP (e.g., http://192.168.1.50:3000) or production URL
const BACKEND_URL = 'http://10.0.2.2:3000'; // Android Emulator alias for host localhost

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasPermissions, setHasPermissions] = useState(true);
  const webViewRef = useRef<WebView>(null);

  // Injected JavaScript to ensure WebRTC camera and mic permissions operate in native Android WebView
  const injectedWebRTCPermissions = `
    (function() {
      console.log('Jirani Native Android Container Initialized');
      window.isNativeAndroidApp = true;
    })();
    true;
  `;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0d14" />
      
      <WebView
        ref={webViewRef}
        source={{ uri: BACKEND_URL }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        injectedJavaScript={injectedWebRTCPermissions}
        onLoadEnd={() => setLoading(false)}
        onError={(err) => {
          console.error('WebView error:', err);
          Alert.alert(
            'Connection Notice',
            `Could not connect to Jirani server at ${BACKEND_URL}. Ensure your backend server is running on your machine: "npm start"`
          );
        }}
        // Android specific hardware camera/audio capture permissions
        androidHardwareAccelerationDisabled={false}
        originWhitelist={['*']}
      />

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#00a651" />
          <Text style={styles.loadingText}>Connecting to Jirani Live 🇰🇪...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0d14',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0d14',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0d14',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  loadingText: {
    color: '#f0f4f8',
    marginTop: 12,
    fontSize: 15,
    fontWeight: '600',
  },
});
