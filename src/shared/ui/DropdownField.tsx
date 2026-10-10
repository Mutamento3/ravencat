import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { useTheme } from '@shared/theme';

/** 下拉字段只负责选择，候选值与当前值由调用方拥有。 */
export default function DropdownField({
  label,
  value,
  options,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
  error?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <Text style={{ color: theme.colors.text.secondary, marginBottom: theme.spacing.sm }}>{label}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => setExpanded(!expanded)}
        style={{
          backgroundColor: theme.colors.surface.input,
          padding: theme.spacing.md,
          borderRadius: theme.radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          ...(error ? { borderWidth: 1, borderColor: theme.colors.feedback.error } : {}),
        }}
      >
        <Text style={{ color: theme.colors.text.primary, flex: 1 }}>
          {options.find((option) => option.value === value)?.label ?? (value || '请选择')}
        </Text>
        <ChevronDown color={theme.colors.text.secondary} size={18} />
      </TouchableOpacity>
      {expanded ? (
        <View
          style={{
            backgroundColor: theme.colors.surface.input,
            borderRadius: theme.radius.md,
            marginTop: theme.spacing.xs,
          }}
        >
          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: value === option.value, disabled }}
              disabled={disabled}
              onPress={() => {
                setExpanded(false);
                onChange(option.value);
              }}
              style={{
                padding: theme.spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ color: theme.colors.text.primary, flex: 1 }}>{option.label}</Text>
              {value === option.value ? <Check size={18} color={theme.colors.text.primary} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.feedback.error, marginTop: theme.spacing.xs }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
