import type { Evidence } from './evidence.ts';

// The model's output is loosely shaped (old reports, odd answers), so every field is optional
// and the renderer treats absence as "not available", never as an error.
export interface Analysis {
  hooks?: { primaryPattern?: string; examples?: string[]; frequency?: string; secondaryPatterns?: string[] };
  thumbnails?: { formula?: string; characteristics?: string[]; textOverlayStyle?: string };
  cadence?: {
    schedule?: string; consistency?: string; durationStrategy?: string; peakPerformanceWindow?: string;
    avgDaysBetweenVideos?: number; videosPerMonth?: number; peakDay?: string; avgDurationMinutes?: number;
  };
  audience?: { primaryProfile?: string; estimatedAge?: string; viewerIntent?: string; loyaltySignal?: string };
  pillars?: { name?: string; percentage?: number; description?: string }[];
  monetization?: { primaryApproach?: string; signals?: string[]; brandAffinities?: string };
  gaps?: { opportunity?: string; rationale?: string }[];
  earningsEstimate?: {
    monthlyViewsEstimate?: number; cpmRPM?: string; estimatedMonthlyAdRevenue?: string;
    otherRevenue?: string; totalEstimate?: string;
  };
  videoIdeas?: { title?: string; rationale?: string; estimatedPerformance?: string }[];
  /** Present on reports made after evidence storage; absent on older ones. */
  evidence?: Evidence;
}

export interface Channel {
  id?: string; name: string; handle?: string; thumbnailUrl?: string; subscriberCount?: number;
}

export interface Report {
  reportId: string;
  channel: Channel;
  videoCount: number;
  analysis: Analysis;
  createdAt: string;
  visibility: 'private' | 'link';
  isOwner: boolean;
  /** Set only on locally generated preview data, never by the server. */
  fixture?: boolean;
}

export interface ReportListItem {
  reportId: string; visibility: 'private' | 'link'; channel: Channel; videoCount: number; createdAt: string;
}

export interface Me {
  user: { id?: string; email: string; name?: string; avatar_url?: string };
  entitlement: { plan: string; label: string; limit: number | null };
  /** null when the usage count could not be read */
  usage: { used: number | null };
}
