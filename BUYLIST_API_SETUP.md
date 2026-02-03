# Buylist API Setup Guide

## Database Schema

Make sure your Supabase `buylist_requests` table has the following structure:

```sql
CREATE TABLE buylist_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_set TEXT,
  card_number TEXT,
  card_rarity TEXT,
  card_image_url TEXT,
  condition TEXT NOT NULL,
  max_price DECIMAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  notify_on_availability BOOLEAN DEFAULT true,
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'active', 
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster queries
CREATE INDEX idx_buylist_user_id ON buylist_requests(user_id);
CREATE INDEX idx_buylist_status ON buylist_requests(status);
CREATE INDEX idx_buylist_card_id ON buylist_requests(card_id);

-- Add RLS policies
ALTER TABLE buylist_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own buylist requests
CREATE POLICY "Users can view own buylist requests"
  ON buylist_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own buylist requests
CREATE POLICY "Users can create own buylist requests"
  ON buylist_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own buylist requests
CREATE POLICY "Users can update own buylist requests"
  ON buylist_requests FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own buylist requests
CREATE POLICY "Users can delete own buylist requests"
  ON buylist_requests FOR DELETE
  USING (auth.uid() = user_id);
```

## API Endpoint

The API endpoint has been created at:
**`app/api/buylist/route.ts`**

### POST `/api/buylist`
Creates a new buylist request. Requires authentication.

**Request Body:**
```json
{
  "card": {
    "id": "string",
    "name": "string",
    "set": "string",
    "number": "string",
    "rarity": "string",
    "imageUrl": "string"
  },
  "condition": "NM" | "M" | "LP" | "MP",
  "maxPrice": "number (string)",
  "quantity": "number (string)",
  "notifyMe": boolean,
  "currency": "string"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "card_id": "string",
    ...
  },
  "message": "Buylist request created successfully"
}
```

**Error Responses:**
- `401 Unauthorized` - User not authenticated
- `400 Bad Request` - Missing required fields
- `500 Internal Server Error` - Database error

### GET `/api/buylist?status=active`
Retrieves user's buylist requests. Requires authentication.

**Query Parameters:**
- `status` (optional): Filter by status (default: "active")

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "card_name": "string",
      "condition": "string",
      "max_price": number,
      "quantity": number,
      ...
    }
  ]
}
```

## Frontend Integration

The `BuylistRequest` component automatically:
1. ✅ Validates form input
2. ✅ Sends POST request to `/api/buylist`
3. ✅ Handles loading states with spinner
4. ✅ Displays success animation
5. ✅ Shows error messages if request fails
6. ✅ Prompts user to sign in if unauthenticated

## Testing

### 1. Test with authenticated user:
- Sign in to the app
- Find a card with no listings
- Click "Shop Now"
- Fill out the buylist form
- Submit
- Check Supabase table for new entry

### 2. Test without authentication:
- Sign out
- Try to submit a buylist request
- Should see: "Please sign in to add items to your buylist"

### 3. Test error handling:
- Disconnect internet before submitting
- Should see: "Network error. Please check your connection and try again."

## Next Steps

To fully utilize the buylist system:

1. **Display user's buylist**: Create a view in the Profile or Vault section to show active buylist requests
2. **Seller notifications**: Set up a cron job or trigger to notify sellers when they can fulfill buylist requests
3. **Matching system**: Create logic to automatically match new listings with active buylist requests
4. **Email notifications**: Send emails to users when cards from their buylist become available

## Status Codes

The API uses standard buylist status codes:
- `active` - Request is active and unfulfilled
- `fulfilled` - Request has been fulfilled by a purchase
- `cancelled` - User cancelled the request
- `expired` - Request expired (if you add expiration logic)
