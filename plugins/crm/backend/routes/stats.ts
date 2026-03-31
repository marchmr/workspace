import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

export default async function statsRoutes(fastify: FastifyInstance): Promise<void> {

    // ─── GET / — KPI-Statistiken für Dashboard ───
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const tenantId = (request.user as any).tenantId;

        // Kunden-Statistiken
        const customerStats = await db('crm_customers')
            .where('tenant_id', tenantId)
            .select(db.raw(`
                COUNT(*) as customers_total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as customers_active,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as customers_inactive,
                SUM(CASE WHEN status = 'prospect' THEN 1 ELSE 0 END) as customers_prospect,
                SUM(CASE WHEN MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW()) THEN 1 ELSE 0 END) as customers_new_month,
                MAX(created_at) as last_customer_created
            `))
            .first();

        // Ticket-Statistiken
        let ticketStats: any = { tickets_open: 0, tickets_in_progress: 0, tickets_due_soon: 0, tickets_overdue: 0, tickets_total: 0 };
        try {
            const ts = await db('crm_tickets')
                .where('tenant_id', tenantId)
                .select(db.raw(`
                    COUNT(*) as tickets_total,
                    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as tickets_open,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as tickets_in_progress,
                    SUM(CASE WHEN due_date IS NOT NULL AND due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY) AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as tickets_due_soon,
                    SUM(CASE WHEN due_date IS NOT NULL AND due_date < NOW() AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as tickets_overdue
                `))
                .first();
            if (ts) {
                ticketStats = {
                    tickets_total: Number(ts.tickets_total || 0),
                    tickets_open: Number(ts.tickets_open || 0),
                    tickets_in_progress: Number(ts.tickets_in_progress || 0),
                    tickets_due_soon: Number(ts.tickets_due_soon || 0),
                    tickets_overdue: Number(ts.tickets_overdue || 0),
                };
            }
        } catch {
            // Tabelle existiert evtl. noch nicht (Migration pending)
        }

        return reply.send({
            customers_total: Number(customerStats?.customers_total || 0),
            customers_active: Number(customerStats?.customers_active || 0),
            customers_inactive: Number(customerStats?.customers_inactive || 0),
            customers_prospect: Number(customerStats?.customers_prospect || 0),
            customers_new_month: Number(customerStats?.customers_new_month || 0),
            last_customer_created: customerStats?.last_customer_created || null,
            ...ticketStats,
        });
    });
}
