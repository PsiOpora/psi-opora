"use client";

import {
  BarChart3Icon,
  BotIcon,
  DatabaseBackupIcon,
  FileTextIcon,
  FilterIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ListIcon,
  MailIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  PlugIcon,
  SendIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_GROUPS = [
  {
    label: "Главное",
    items: [{ href: "/", label: "Обзор", icon: LayoutDashboardIcon }],
  },
  {
    label: "Аналитика",
    items: [
      { href: "/funnel", label: "Воронка", icon: FilterIcon },
      { href: "/utm", label: "UTM-отчёт", icon: TagsIcon },
      { href: "/sources", label: "Источники", icon: BarChart3Icon },
      { href: "/bot-funnel", label: "Бот-воронка", icon: BotIcon },
      { href: "/costs", label: "Расходы", icon: WalletIcon },
      { href: "/ads", label: "Реклама", icon: MegaphoneIcon },
      { href: "/builder", label: "Конструктор", icon: SlidersHorizontalIcon },
    ],
  },
  {
    label: "CRM",
    items: [{ href: "/deals", label: "Сделки", icon: ListIcon }],
  },
  {
    label: "Коммуникации",
    items: [
      { href: "/broadcast", label: "Рассылка", icon: SendIcon },
      { href: "/email-broadcast", label: "Email-рассылка", icon: MailIcon },
      {
        href: "/email-templates",
        label: "Шаблоны писем",
        icon: FileTextIcon,
      },
    ],
  },
  {
    label: "Настройки",
    items: [
      {
        href: "/settings/bot",
        label: "Тексты бота",
        icon: MessageSquareTextIcon,
      },
      { href: "/settings/connectors", label: "Каналы ботов", icon: PlugIcon },
      { href: "/settings/ads", label: "Настройки", icon: SettingsIcon },
      {
        href: "/settings/backup",
        label: "Бэкап CRM",
        icon: DatabaseBackupIcon,
      },
      {
        href: "/settings/email",
        label: "Настройки Email",
        icon: KeyRoundIcon,
      },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BarChart3Icon className="size-4" />
          </div>
          <div className="flex flex-col text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-medium">Пси-Опора</span>
            <span className="text-muted-foreground">CRM аналитика</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
