import { Alert } from '@heroui/react';

/** Galat formulir/aksi; `role="alert"` agar dibacakan pembaca layar. */
export const ErrorAlert = ({ message }: { message: string }) => (
  <Alert status="danger" role="alert">
    <Alert.Indicator />
    <Alert.Content><Alert.Description>{message}</Alert.Description></Alert.Content>
  </Alert>
);
