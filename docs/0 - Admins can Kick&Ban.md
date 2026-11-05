# Admins Can Kick & Ban Group Members

## Summary

This change allows group admins (in addition to group owners) to kick and ban regular group members. It also includes a critical fix that prevents Qortal-Hub from crashing when the kick/ban API calls throw errors. Previously, only group owners could perform these actions.

## Files Modified

- `src/background/background.ts`
- `src/components/Group/ListOfMembers.tsx`

## Changes Explained

### 1. Improved Error Handling in background.ts (Lines 790-809)

**Problem**: The `processTransactionVersion2` function was not properly handling HTTP error responses from the Qortal Core. When an API call failed (e.g., kick/ban operation), the app would crash or hang.

**Solution**: Added comprehensive error response parsing before the existing try-catch block.

**Before:**

```typescript
// if (!response.ok) {
//   // If the response is not successful (status code is not 2xx)
//   throw new Error(`HTTP error! Status: ${response.status}`);
// }

try {
  const json = await response.clone().json();
```

**After:**

```typescript
// Check if the response is not successful (status code is not 2xx)
if (!response.ok) {
  // Try to parse error from response
  let errorMessage = `HTTP error! Status: ${response.status}`;
  try {
    const json = await response.clone().json();
    if (json?.message) {
      errorMessage = json.message;
    } else if (json?.error) {
      errorMessage = json.error;
    } else {
      const text = await response.text();
      if (text) errorMessage = text;
    }
  } catch {
    const text = await response.text();
    if (text) errorMessage = text;
  }
  throw new Error(errorMessage);
}

try {
  const json = await response.clone().json();
```

**Reason**: When the Core returns an error (e.g., "Admin cannot kick another admin"), the response contains error details in JSON or text form. This code extracts the actual error message to display to the user instead of a generic "HTTP error" message. The app no longer crashes—it properly catches and displays Core API errors.

---

### 2. Permission Expansion in ListOfMembers.tsx

**Problem**: Only group owners could kick/ban members, limiting administrative capabilities.

**Solution**: Expanded permissions to include admins for kick/ban operations.

#### 2a. Kick Member Function (Lines ~410-450)

**Before:** Used Promise chain with `.then()/.catch()` that swallowed errors
**After:** Uses async/await with proper try-catch-finally

**Old kick function:**

```typescript
setIsLoadingKick(true);
new Promise((res, rej) => {
  window
    .sendMessage('kickFromGroup', {
      groupId,
      qortalAddress: address,
    })
    .then((response) => {
      if (!response?.error) {
        setInfoSnack({
          type: 'success',
          message: t('group:message.success.group_kick', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        handlePopoverClose();
        res(response);
        return;
      }
      setInfoSnack({
        type: 'error',
        message: response?.error,
      });
      setOpenSnack(true);
      rej(response.error);
    })
    .catch((error) => {
      setInfoSnack({
        type: 'error',
        message:
          error.message ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
      rej(error);
    });
});
```

**New kick function:**

```typescript
setIsLoadingKick(true);
const response = await window.sendMessage('kickFromGroup', {
  groupId,
  qortalAddress: address,
});
if (!response?.error) {
  setInfoSnack({
    type: 'success',
    message: t('group:message.success.group_kick', {
      postProcess: 'capitalizeFirstChar',
    }),
  });
  setOpenSnack(true);
  handlePopoverClose();
  return;
}
setInfoSnack({
  type: 'error',
  message:
    response?.message ||
    response?.error ||
    t('core:message.error.generic', {
      postProcess: 'capitalizeFirstChar',
    }),
});
setOpenSnack(true);
} catch (error) {
  console.error(error);
  setInfoSnack({
    type: 'error',
    message:
      error?.message ||
      error ||
      t('core:message.error.generic', {
        postProcess: 'capitalizeFirstChar',
      }),
  });
  setOpenSnack(true);
```

**Key improvements:**

1. **Error message priority**: Now checks `response?.message` before `response?.error` for more specific error messages from the Core
2. **Proper exception handling**: The catch block now logs to `console.error()` instead of `console.log()`
3. **Consistent error object access**: Falls back to `error?.message || error` for reliable error display

#### 2b. Ban Member Function (Lines ~466-510)

**Old ban function:** Same Promise pattern with `.then()/.catch()`

**New ban function:**

```typescript
setIsLoadingBan(true);

const response = await window.sendMessage('banFromGroup', {
  groupId,
  qortalAddress: address,
  rBanTime: 0,
});
if (!response?.error) {
  setInfoSnack({
    type: 'success',
    message: t('group:message.success.group_ban', {
      postProcess: 'capitalizeFirstChar',
    }),
  });
  setOpenSnack(true);
  handlePopoverClose();
  return;
}
setInfoSnack({
  type: 'error',
  message:
    response?.message ||
    response?.error ||
    t('core:message.error.generic', {
      postProcess: 'capitalizeFirstChar',
    }),
});
setOpenSnack(true);
} catch (error) {
  console.error(error);
  setInfoSnack({
    type: 'error',
    message:
      error?.message ||
      error ||
      t('core:message.error.generic', {
        postProcess: 'capitalizeFirstChar',
      }),
  });
  setOpenSnack(true);
```

#### 2c. UI Permission Changes (Lines ~808-974)

**Popover visibility** (previously check: `isOwner`, new check: `isOwner || isAdmin`)

- Line ~808: Popover component now shows for both owners and admins
- Line ~843: Popover content conditional rendering for kick/ban buttons updated

**Before:**

```typescript
{isOwner && (
  <Popover
    open={openPopoverIndex === index}
```

**After:**

```typescript
{(isOwner || isAdmin) && (
  <Popover
    open={openPopoverIndex === index,
```

**Before:**

```typescript
{isOwner && (
  <>
    <LoadingButton loading={isLoadingKick} ...>Kick</LoadingButton>
    <LoadingButton loading={isLoadingBan} ...>Ban</LoadingButton>
  </>
)}
```

**After:**

```typescript
{(isOwner || isAdmin) && (
  <LoadingButton loading={isLoadingKick} ...>Kick</LoadingButton>
  <LoadingButton loading={isLoadingBan} ...>Ban</LoadingButton>
)}
{isOwner && (
  <LoadingButton ...>Make Admin</LoadingButton>
  <LoadingButton ...>Remove Admin</LoadingButton>
)}
```

**Context menu trigger** (on right-click):

- Line ~943: `onContextMenu` now accepts events from both owners and admins

**Before:**

```typescript
onClick={
  isOwner ? (event) => handlePopoverOpen(event, index) : undefined
}
```

**After:**

```typescript
onClick={
  (isOwner || isAdmin) ? (event) => handlePopoverOpen(event, index) : undefined
}
```

**Cursor style:**

- Line ~973: Changed from `'pointer'` for owner-only to pointer for owners OR admins

**Before:**

```typescript
sx={{
  borderRadius: compact ? '6px' : undefined,
  cursor: isOwner ? 'pointer' : 'default',
```

**After:**

```typescript
sx={{
  borderRadius: compact ? '6px' : undefined,
  cursor: (isOwner || isAdmin) ? 'pointer' : 'default',
```

---

## Backend Validation

The Core blockchain enforces these rules server-side:

- Admins **can** kick/ban regular members
- Admins **cannot** kick/ban other admins
- Admins **cannot** kick/ban the group owner
- Only the owner can manage admin status (make/remove admins)

The Core returns appropriate error messages like "Admin cannot kick another admin" which the updated error handling now properly displays to the user.

---

## Testing Considerations

When testing this feature:

1. **Test as owner**: Verify can kick/ban admins and regular members
2. **Test as admin**: Verify can kick/ban regular members but NOT other admins or the owner
3. **Test error handling**: Attempt invalid operations (admin kicking admin) and verify the error message from the Core is displayed in the snack notification
4. **Test edge cases**: Verify the UI correctly shows/hides the kick/ban menu based on `isOwner || isAdmin`
