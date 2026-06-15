# MeetBook Admin UI

Production-grade admin dashboard for MeetBook platform. Pure HTML, CSS, JavaScript - no external libraries.

## Features

- **Dashboard**: Real-time metrics, charts, and statistics
- **Reports Management**: View, claim, and resolve user reports
- **User Management**: List, search, suspend, and reinstate users
- **Book Management**: List, search, and take down books
- **Exchange Management**: Monitor all book exchanges
- **Blocked Places**: Manage geographically blocked locations
- **Audit Log**: Track all admin actions

## Backend Endpoints

### Authentication
- `POST /api/v1/auth/login` - Admin login

### Admin Endpoints
- `GET /api/v1/admin/metrics` - Dashboard metrics
- `GET /api/v1/admin/reports` - List reports (filter by status)
- `POST /api/v1/admin/reports/{id}/claim` - Claim a report
- `POST /api/v1/admin/reports/{id}/resolve` - Resolve a report
- `GET /api/v1/admin/users` - List users (search, filter by status)
- `GET /api/v1/admin/users/{id}` - Get user details
- `POST /api/v1/admin/users/{id}/suspend` - Suspend user
- `POST /api/v1/admin/users/{id}/reinstate` - Reinstate user
- `GET /api/v1/admin/books` - List books (search, filter availability)
- `GET /api/v1/admin/books/{id}` - Get book details
- `POST /api/v1/admin/books/{id}/takedown` - Take down book
- `GET /api/v1/admin/exchanges` - List exchanges (filter by status)
- `GET /api/v1/admin/exchanges/{id}` - Get exchange details
- `GET /api/v1/admin/blocked-places` - List blocked places
- `POST /api/v1/admin/blocked-places` - Create blocked place
- `DELETE /api/v1/admin/blocked-places/{id}` - Delete blocked place
- `GET /api/v1/admin/audit-log` - List audit logs (filter by user, event type)

## Usage

1. Start the backend server
2. Open `admin/index.html` in a browser
3. Login with admin credentials
4. Navigate through the dashboard

## Design Features

- Dark theme with modern UI
- Responsive design (mobile, tablet, desktop)
- Real-time data updates
- Toast notifications
- Modal dialogs
- Pagination
- Search and filter capabilities
- Keyboard accessible
- Print-friendly styles

## Security

- JWT authentication required for all admin endpoints
- Role-based access control (admin only)
- Input validation on all forms
- XSS protection via proper escaping
- CSRF protection via SameSite cookies