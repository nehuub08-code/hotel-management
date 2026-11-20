export type RoleCode =
  | 'super_admin'
  | 'owner'
  | 'manager'
  | 'kitchen'
  | 'waiter'
  | 'cashier'
  | 'customer';

export type OrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Accepted'
  | 'Preparing'
  | 'Cooking'
  | 'Ready'
  | 'Served'
  | 'Completed'
  | 'Cancelled';

export type TableStatus =
  | 'Available'
  | 'Occupied'
  | 'Reserved'
  | 'Ordering'
  | 'Food Preparing'
  | 'Ready to Serve'
  | 'Billing'
  | 'Cleaning';

export type ServiceRequestType =
  | 'Water'
  | 'Napkins'
  | 'Waiter Assistance'
  | 'Additional Plates'
  | 'Cutlery'
  | 'Bill Request'
  | 'Custom';

export type ServiceRequestStatus = 'Pending' | 'Acknowledged' | 'In Progress' | 'Completed';

export type SpiceLevel = 'Mild' | 'Medium' | 'Hot';

export interface RestaurantDTO {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  cuisineType: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  openingHours: Record<string, string>;
  socialLinks: Record<string, string>;
  googleReviewUrl: string;
  currencyCode: string;
  currencySymbol: string;
  taxRatePercent: number;
  serviceChargePercent: number;
  allowNegativeStock: boolean;
  cancellationRuleMinutes: number;
  upiVpa: string;
  upiMerchantName: string;
  isActive: boolean;
}

export interface MenuVariantDTO {
  id: number;
  menuItemId: number;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
}

export interface MenuAddonDTO {
  id: number;
  menuItemId: number;
  name: string;
  priceCents: number;
  isAvailable: boolean;
}

export interface MenuCategoryDTO {
  id: number;
  restaurantId: number;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItemDTO {
  id: number;
  restaurantId: number;
  categoryId: number;
  name: string;
  description: string;
  basePriceCents: number;
  imageKey: string;
  isVegetarian: boolean;
  isVegan: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  prepTimeMinutes: number;
  defaultSpiceLevel: SpiceLevel;
  allergenCodes: string[];
  sortOrder: number;
  variants: MenuVariantDTO[];
  addons: MenuAddonDTO[];
}

export interface TableDTO {
  id: number;
  restaurantId: number;
  tableNumber: string;
  label: string;
  capacity: number;
  zone: string;
  posX: number;
  posY: number;
  status: TableStatus;
  qrToken: string;
  qrVersion: number;
  currentGuestCount: number;
  activeSessionId: number | null;
}

export interface SessionParticipant {
  id: string;
  name: string;
  joinedAt: string;
}

export interface TableSessionDTO {
  id: number;
  restaurantId: number;
  tableId: number;
  sessionToken: string;
  guestCount: number;
  hostName: string;
  participants: SessionParticipant[];
  status: string;
  selectedMode?: string;
  preferredLanguage?: string;
  notificationConsent?: boolean;
  guestPhone?: string;
  guestEmail?: string;
  welcomeShownAt?: string | null;
  goodbyeShownAt?: string | null;
  openedAt: string;
}

export interface OrderItemDTO {
  id: number;
  orderId: number;
  menuItemId: number | null;
  itemName: string;
  quantity: number;
  unitPriceCents: number;
  variantName: string;
  variantPriceDeltaCents: number;
  addons: { name: string; priceCents: number }[];
  spiceLevel: SpiceLevel;
  specialInstructions: string;
  lineTotalCents: number;
  kitchenStatus: string;
}

export interface OrderDTO {
  id: number;
  restaurantId: number;
  tableId: number | null;
  tableNumber?: string;
  tableSessionId: number | null;
  orderNumber: string;
  customerName: string;
  guestCount: number;
  status: OrderStatus;
  priority: 'normal' | 'rush' | 'vip';
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  discountCents: number;
  discountCode: string;
  totalCents: number;
  estimatedPrepMinutes: number;
  notes: string;
  createdAt: string;
  acceptedAt: string | null;
  cookingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  items: OrderItemDTO[];
}

export interface ServiceRequestDTO {
  id: number;
  restaurantId: number;
  tableId: number;
  tableNumber: string;
  requestType: ServiceRequestType;
  customMessage: string;
  status: ServiceRequestStatus;
  handledByName: string;
  createdAt: string;
  completedAt: string | null;
}

export interface InvoiceDTO {
  id: number;
  restaurantId: number;
  orderId: number | null;
  tableSessionId: number | null;
  invoiceNumber: string;
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  discountCents: number;
  totalCents: number;
  status: string;
  issuedAt: string;
  paidAt: string | null;
  items: {
    id: number;
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
}

export interface PaymentDTO {
  id: number;
  restaurantId: number;
  invoiceId: number;
  orderId: number | null;
  paymentMethod: string;
  amountCents: number;
  currency: string;
  providerOrderId: string;
  providerPaymentId: string;
  webhookVerified: boolean;
  status: string;
  reconciliationNote: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ReviewDTO {
  id: number;
  restaurantId: number;
  orderId: number | null;
  customerName: string;
  overallRating: number;
  foodRating: number;
  serviceRating: number;
  experienceRating: number;
  comment: string;
  isApproved: boolean;
  createdAt: string;
}

export interface ReservationDTO {
  id: number;
  restaurantId: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  preferredZone: string;
  specialRequests: string;
  status: string;
  assignedTableId: number | null;
  createdAt: string;
}

export interface InventoryItemDTO {
  id: number;
  restaurantId: number;
  name: string;
  sku: string;
  category: string;
  currentStock: number;
  unit: string;
  minThreshold: number;
  costPerUnitCents: number;
  supplierName: string;
  lastRestockedAt: string;
}

export interface NotificationDTO {
  id: number;
  restaurantId: number;
  targetRole: string;
  type: string;
  title: string;
  message: string;
  linkTarget: string;
  isRead: boolean;
  createdAt: string;
}

export interface CartItem {
  cartId: string;
  menuItemId: number;
  name: string;
  imageKey: string;
  quantity: number;
  basePriceCents: number;
  variantName: string;
  variantPriceDeltaCents: number;
  addons: { name: string; priceCents: number }[];
  spiceLevel: SpiceLevel;
  specialInstructions: string;
  prepTimeMinutes: number;
  addedBy?: string;
}

export interface AuthSession {
  userId: number;
  uid: string;
  email: string;
  fullName: string;
  role: RoleCode;
  isSuperAdmin: boolean;
  restaurantId: number;
  token: string;
  isSandbox: boolean;
}

export interface AiRecommendationItemDTO {
  id?: number;
  menuItemId: number;
  name: string;
  description: string;
  imageKey: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  isVegetarian: boolean;
  defaultSpiceLevel: SpiceLevel;
  prepTimeMinutes: number;
  reason: string;
  wasAddedToCart?: boolean;
}

export interface AiRecommendationResponseDTO {
  sessionId: number;
  summaryText: string;
  budgetTargetCents: number;
  budgetScope: 'per_person' | 'entire_table';
  guestCount: number;
  totalRecommendedCents: number;
  items: AiRecommendationItemDTO[];
}

export interface VoiceParsedItemDTO {
  menuItemId: number | null;
  spokenPhrase: string;
  matchedItemName: string;
  quantity: number;
  variantName: string;
  spiceLevel: SpiceLevel;
  specialInstructions: string;
  unitPriceCents: number;
  lineTotalCents: number;
  imageKey?: string;
  isAvailable: boolean;
  confidence: 'exact' | 'fuzzy' | 'ambiguous' | 'unavailable';
}

export interface VoiceOrderParseResponseDTO {
  voiceSessionId: number;
  language: string;
  rawTranscript: string;
  items: VoiceParsedItemDTO[];
  ambiguities: string[];
  estimatedTotalCents: number;
}

export interface AssistantChartDTO {
  chartType: 'bar' | 'line';
  title: string;
  xKey: string;
  yKey: string;
  data: Record<string, string | number>[];
}

export interface AssistantMessageDTO {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed: string[];
  chartData: AssistantChartDTO | null;
  dateRangeLabel: string;
  createdAt: string;
}

export interface AssistantConversationDTO {
  id: number;
  restaurantId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateDTO {
  id: number;
  restaurantId: number;
  eventKey: string;
  title: string;
  messageBody: string;
  preferredLanguage: string;
  isEnabled: boolean;
  channels: string[];
  updatedAt: string;
}

export interface NotificationLogDTO {
  id: number;
  restaurantId: number;
  tableSessionId: number | null;
  orderId: number | null;
  eventKey: string;
  dedupeKey: string;
  recipientRole: string;
  recipientName: string;
  channel: string;
  title: string;
  renderedMessage: string;
  deliveryStatus: string;
  retryCount: number;
  errorDetail: string;
  createdAt: string;
}

export interface NotificationPreferenceDTO {
  id: number;
  restaurantId: number;
  targetRole: string;
  inAppEnabled: boolean;
  browserPushEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  soundEnabled: boolean;
  mutedEventTypes: string[];
}

export interface Food3dModelDTO {
  id: number;
  restaurantId: number;
  menuItemId: number;
  modelTitle: string;
  proceduralPreset: string;
  glbUrl: string;
  usdzUrl: string;
  scaleFactor: number;
  arEnabled: boolean;
  previewNotes: string;
  updatedAt: string;
}

export interface RealtimeEvent<T = unknown> {
  type:
    | 'connected'
    | 'order:created'
    | 'order:updated'
    | 'table:updated'
    | 'session:updated'
    | 'service_request:created'
    | 'service_request:updated'
    | 'payment:verified'
    | 'notification:created'
    | 'customer_message'
    | 'inventory:updated';
  restaurantId: number;
  payload: T;
  timestamp: string;
}
