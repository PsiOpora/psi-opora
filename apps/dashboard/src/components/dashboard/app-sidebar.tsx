"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3Icon,
  BotIcon,
  FilterIcon,
  LayoutDashboardIcon,
  ListIcon,
  MegaphoneIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  WalletIcon,
  SettingsIcon,
} from "lucide-react";
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

const NAV_ITEMS = [
  { href: "/", label: "Обзор", icon: LayoutDashboardIcon },
  { href: "/funnel", label: "Воронка", icon: FilterIcon },
  { href: "/utm", label: "UTM-отчёт", icon: TagsIcon },
  { href: "/sources", label: "Источники", icon: BarChart3Icon },
  { href: "/bot-funnel", label: "Бот-воронка", icon: BotIcon },
  { href: "/costs", label: "Расходы", icon: WalletIcon },
  { href: "/ads", label: "Реклама", icon: MegaphoneIcon },
  { href: "/deals", label: "Сделки", icon: ListIcon },
  { href: "/builder", label: "Конструктор", icon: SlidersHorizontalIcon },
  { href: "/settings/ads", label: "Настройки", icon: SettingsIcon },
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
        <SidebarGroup>
          <SidebarGroupLabel>Маркетинг</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
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
      </SidebarContent>
    </Sidebar>
  );
}
