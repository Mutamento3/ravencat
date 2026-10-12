/** 渲染单聊选项页复用的助手信息、菜单项与图标组件。 */

import { ThemedSurface } from '@shared/theme';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BookOpen, HeartHandshake } from 'lucide-react-native';

interface MenuItemData {
  key: string;
  icon?: React.ReactNode;
  title: string;
  onPress?: () => void;
  danger?: boolean;
  center?: boolean;
}

interface MenuSectionProps {
  items: MenuItemData[];
  styles: Record<string, any>;
}

interface MenuItemProps {
  icon?: React.ReactNode;
  title: string;
  onPress?: () => void;
  danger?: boolean;
  center?: boolean;
  styles: Record<string, any>;
}

interface IconProps {
  color: string;
}

export function MenuSection({ items, styles }: MenuSectionProps) {
  return (
    <ThemedSurface variant="card" style={styles.section}>
      {items.map((item) => (
        <MenuItem
          key={item.key}
          icon={item.icon}
          title={item.title}
          onPress={item.onPress}
          danger={item.danger}
          center={item.center}
          styles={styles}
        />
      ))}
    </ThemedSurface>
  );
}

export function MenuItem({ icon, title, onPress, danger = false, center = false, styles }: MenuItemProps) {
  return (
    <TouchableOpacity style={[styles.menuItem, center && styles.menuItemCenter]} onPress={onPress} activeOpacity={0.7}>
      {icon ? <View style={styles.iconContainer}>{icon}</View> : null}
      <View style={[styles.content, center && styles.contentCenter]}>
        <Text style={[styles.title, danger && styles.dangerTitle]}>{title}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function ProtocolIcon({ color }: IconProps) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name="document-text" size={22} color={color} />
    </View>
  );
}

export function SummaryIcon({ color }: IconProps) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <BookOpen size={22} color={color} />
    </View>
  );
}

export function StatisticsIcon({ color }: IconProps) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <HeartHandshake size={22} color={color} />
    </View>
  );
}

export function ClearHistoryIcon({ color }: IconProps) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name="trash-bin-outline" size={22} color={color} />
    </View>
  );
}

export function SettingsIcon({ color }: IconProps) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name="options" size={22} color={color} />
    </View>
  );
}

export function ChatSettingsIcon({ color, danger = false }: IconProps & { danger?: boolean }) {
  return (
    <View style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons
        name="chatbubbles"
        size={22}
        color={danger ? color : color}
      />
    </View>
  );
}
