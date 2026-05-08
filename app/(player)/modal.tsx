import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SPACING } from '@/constants/screenLayout'

export default function ModalScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Đây là màn hình hộp thoại</ThemedText>
      <Link href="/" dismissTo style={styles.link}>
        <ThemedText type="link">Về trang chủ</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
