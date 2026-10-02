import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';

export interface PickerOption<T> {
  value: T;
  label: string;
  detail?: string;
}

/** A pill that opens a picker; filled in when it is narrowing the list. */
export function FilterButton({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: active ? theme.accent : theme.card,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.border,
        flexShrink: 1,
      })}
    >
      <Text
        numberOfLines={1}
        style={{ color: active ? '#FFFFFF' : theme.muted, fontWeight: '600', fontSize: 13 }}
      >
        {label}: {value}
      </Text>
      <Text style={{ color: active ? '#FFFFFF' : theme.faint, fontSize: 10 }}>▼</Text>
    </Pressable>
  );
}

/**
 * A bottom sheet of options, one of which is selected. Picking a row closes
 * the sheet; so does tapping outside it.
 */
export function PickerSheet<T>({
  title,
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  visible: boolean;
  options: PickerOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: theme.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: '70%',
          paddingBottom: insets.bottom + 8,
        }}
      >
        <Text
          style={{
            color: theme.text,
            fontSize: 17,
            fontWeight: '800',
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 10,
          }}
        >
          {title}
        </Text>
        <ScrollView>
          {options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <Pressable
                key={String(option.value)}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  paddingVertical: 13,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                  backgroundColor: pressed ? theme.bg : 'transparent',
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: isSelected ? theme.accent : theme.text,
                      fontSize: 15,
                      fontWeight: isSelected ? '700' : '600',
                    }}
                  >
                    {option.label}
                  </Text>
                  {option.detail ? (
                    <Text style={{ color: theme.faint, fontSize: 12, marginTop: 2 }}>
                      {option.detail}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>✓</Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
