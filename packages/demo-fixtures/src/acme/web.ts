import type { ConditionSeed } from '../console/builders.ts';
import { FUTURE_START, LAUNCH_DAY, PAST_END, PAST_START, PEOPLE as P } from './people.ts';
import type { ProjectSeed } from './seed-types.ts';

const STAFF_EMAIL: ConditionSeed = { type: 'email', operator: 'str_contains_any', targetValue: ['@acmeretail.example'] };

/**
 * `acme-web`: the storefront's StatSig project (Cloud). Designed so every condition type and
 * operator the Console API can express appears at least once (PLAN §19.2, §10.3).
 *
 * Names shared with `acme-mobile` (consolidation demo):
 * - identical: employees_only, maintenance_mode, kill_switch_payments
 * - different: new_checkout_flow, dark_mode, search_v2
 * - shared segment name: beta_testers; shared event: purchase
 */
export function acmeWeb(): ProjectSeed {
  return {
    alias: 'web',
    projectName: 'acme-web',
    companyName: 'Acme Retail',
    isWarehouseNative: false,
    environments: [
      { name: 'development', isProduction: false },
      { name: 'staging', isProduction: false },
      { name: 'production', isProduction: true },
      // Custom tier with no LD match → env_unmapped decision.
      { name: 'qa', isProduction: false },
    ],
    unitTypes: [
      { name: 'userID', description: 'Logged-in customer ID' },
      { name: 'stableID', description: 'Device-stable anonymous ID' },
      { name: 'companyID', description: 'B2B account ID' },
    ],
    tags: [
      { name: 'checkout', description: 'Checkout team' },
      { name: 'search', description: 'Search & discovery' },
      { name: 'growth', description: 'Growth experiments' },
      { name: 'platform', description: 'Platform / infra' },
      { name: '★ Core', description: 'Core tag', isCore: true },
    ],
    targetApps: ['storefront-web', 'storefront-api', 'storefront-client-only'],
    teams: ['Checkout', 'Search', 'Growth', 'Platform'],
    users: [
      { ...P.alice, role: 'Admin' },
      { ...P.bob, role: 'Member' },
      { ...P.priya, role: 'Member' },
      { ...P.marco, role: 'Member' },
      { ...P.sam, role: 'Read Only' },
    ],
    gates: [
      // --- Checkout ---------------------------------------------------------------------------
      {
        id: 'new_checkout_flow',
        description: 'One-page checkout. Staff first, then beta testers, then a 20% public rollout.',
        owner: P.bob,
        tags: ['checkout'],
        team: 'Checkout',
        holdoutIDs: ['checkout_holdout'],
        rules: [
          { name: 'Acme staff', conditions: [STAFF_EMAIL] },
          { name: 'Beta testers', conditions: [{ type: 'passes_segment', targetValue: 'beta_testers' }] },
          // Partial rollout → partial_rollout_rebucket acknowledgement.
          { name: 'Public 20%', passPercentage: 20, conditions: [{ type: 'public' }] },
        ],
        checksPerHour: 48_000,
      },
      {
        id: 'checkout_express_pay',
        description: 'Express pay button. Depends on new_checkout_flow, which has a partial rollout (cannot be inlined exactly).',
        owner: P.bob,
        tags: ['checkout'],
        rules: [
          {
            name: 'New checkout in North America',
            conditions: [
              { type: 'passes_gate', targetValue: 'new_checkout_flow' },
              { type: 'country', operator: 'any', targetValue: ['US', 'CA'] },
            ],
          },
        ],
      },
      {
        id: 'checkout_promo_banner',
        description: 'Promo banner for staff only; references a gate with no partial rollout (inlinable).',
        owner: P.bob,
        tags: ['checkout'],
        rules: [{ name: 'Staff', conditions: [{ type: 'passes_gate', targetValue: 'employees_only' }] }],
      },
      {
        id: 'checkout_targeting_gate',
        description: 'Targeting gate for checkout experiments: US web users.',
        owner: P.bob,
        tags: ['checkout'],
        rules: [{ name: 'US', conditions: [{ type: 'country', operator: 'any', targetValue: ['US'] }] }],
      },
      {
        id: 'kill_switch_payments',
        description: 'Emergency kill switch for the payments provider integration.',
        owner: P.sam,
        tags: ['platform'],
        type: 'PERMANENT',
        rules: [{ name: 'Everyone', conditions: [{ type: 'public' }] }],
      },
      {
        id: 'maintenance_mode',
        description: 'Show the maintenance page.',
        owner: P.sam,
        tags: ['platform'],
        type: 'PERMANENT',
        rules: [{ name: 'Internal IPs', conditions: [{ type: 'ip_address', operator: 'any', targetValue: ['10.0.0.1', '10.0.0.2'] }] }],
      },
      {
        id: 'employees_only',
        description: 'Anyone with an Acme email address.',
        owner: P.alice,
        tags: ['platform'],
        type: 'PERMANENT',
        rules: [{ name: 'Acme staff', conditions: [STAFF_EMAIL] }],
      },
      // --- Search ------------------------------------------------------------------------------
      {
        id: 'search_v2',
        description: 'New search backend for paying plans. `any` is case-insensitive in StatSig.',
        owner: P.priya,
        tags: ['search'],
        team: 'Search',
        rules: [
          {
            name: 'Pro & Enterprise, English',
            conditions: [
              { type: 'custom_field', field: 'plan', operator: 'any', targetValue: ['Pro', 'Enterprise'] },
              { type: 'locale', operator: 'any', targetValue: ['en_US', 'en_GB', 'en_CA'] },
            ],
          },
        ],
      },
      {
        id: 'search_autocomplete',
        description: 'Autocomplete for specific QA accounts (case-sensitive match).',
        owner: P.priya,
        tags: ['search'],
        rules: [{ name: 'QA accounts', conditions: [{ type: 'user_id', operator: 'any_case_sensitive', targetValue: ['QA-Alpha', 'QA-Beta'] }] }],
      },
      {
        id: 'search_typo_tolerance',
        description: 'Typo tolerance, excluding test accounts and some locales.',
        owner: P.priya,
        tags: ['search'],
        rules: [
          {
            name: 'Real users outside JP/KR',
            conditions: [
              { type: 'email', operator: 'str_contains_none', targetValue: ['+test', 'loadtest'] },
              { type: 'locale', operator: 'none', targetValue: ['ja_JP', 'ko_KR'] },
              { type: 'user_id', operator: 'none_case_sensitive', targetValue: ['BOT-1', 'BOT-2'] },
            ],
          },
        ],
      },
      // --- Derived attributes (browser / OS / country from IP) ---------------------------------
      {
        id: 'dark_mode',
        description: 'Dark mode on browsers with good CSS variable support.',
        owner: P.marco,
        tags: ['growth'],
        rules: [{ name: 'Modern browsers', conditions: [{ type: 'browser_name', operator: 'any', targetValue: ['Chrome', 'Firefox', 'Edge'] }] }],
      },
      {
        id: 'legacy_browser_banner',
        description: 'Upgrade banner for old Safari.',
        owner: P.marco,
        tags: ['growth'],
        rules: [
          {
            name: 'Old Safari',
            conditions: [
              { type: 'browser_name', operator: 'any', targetValue: ['Safari'] },
              { type: 'browser_version', operator: 'version_lt', targetValue: '15.0' },
            ],
          },
        ],
      },
      {
        id: 'windows_download_cta',
        description: 'Desktop app CTA on Windows 10+. `version_gte` must map to semVerLessThan + negate.',
        owner: P.marco,
        tags: ['growth'],
        rules: [
          {
            name: 'Windows 10+',
            conditions: [
              { type: 'os_name', operator: 'any', targetValue: ['Windows'] },
              { type: 'os_version', operator: 'version_gte', targetValue: '10.0.0' },
            ],
          },
        ],
      },
      {
        id: 'eu_cookie_banner',
        description: 'Cookie consent banner in the EU (country derived from IP).',
        owner: P.alice,
        tags: ['platform'],
        type: 'PERMANENT',
        rules: [{ name: 'EU', conditions: [{ type: 'country', operator: 'any', targetValue: ['DE', 'FR', 'ES', 'IT', 'NL', 'IE'] }] }],
      },
      {
        id: 'bot_detection_challenge',
        description: 'Show a challenge to user agents that look like bots.',
        owner: P.sam,
        tags: ['platform'],
        rules: [{ name: 'Bot UAs', conditions: [{ type: 'user_agent', operator: 'str_contains_any', targetValue: ['bot', 'crawler', 'spider'] }] }],
      },
      // --- Time ---------------------------------------------------------------------------------
      {
        id: 'holiday_sale_2025',
        description: 'Holiday sale window. Entirely in the past: resolves statically.',
        owner: P.marco,
        tags: ['growth'],
        rules: [
          {
            name: 'Sale window',
            conditions: [
              { type: 'time', operator: 'after', targetValue: PAST_START },
              { type: 'time', operator: 'before', targetValue: PAST_END },
            ],
          },
        ],
      },
      {
        id: 'black_friday_2027',
        description: 'Black Friday pricing; starts in the future → scheduled change or decision.',
        owner: P.marco,
        tags: ['growth'],
        rules: [{ name: 'From Black Friday', conditions: [{ type: 'time', operator: 'after', targetValue: FUTURE_START }] }],
      },
      // --- Environment scoping ----------------------------------------------------------------
      {
        id: 'staff_debug_tools',
        description: 'Debug tools in non-production tiers only (environment_tier condition).',
        owner: P.sam,
        tags: ['platform'],
        rules: [{ name: 'Dev & staging', conditions: [{ type: 'environment_tier', operator: 'any', targetValue: ['development', 'staging'] }] }],
      },
      {
        id: 'qa_debug_panel',
        description: 'Debug panel enabled only in the custom qa environment (no LD match).',
        owner: P.sam,
        tags: ['platform'],
        rules: [{ name: 'QA everyone', environments: ['qa'], conditions: [{ type: 'public' }] }],
      },
      {
        id: 'perf_monitoring_v2',
        description: 'Per-environment rules: full in staging, 10% in production.',
        owner: P.sam,
        tags: ['platform'],
        rules: [
          { name: 'Staging all', environments: ['staging'], conditions: [{ type: 'public' }] },
          { name: 'Prod 10%', environments: ['production'], passPercentage: 10, conditions: [{ type: 'public' }] },
        ],
      },
      // --- Custom unit types / segments --------------------------------------------------------
      {
        id: 'b2b_bulk_ordering',
        description: 'Bulk ordering for specific B2B accounts (companyID unit type).',
        owner: P.bob,
        idType: 'companyID',
        tags: ['checkout'],
        rules: [{ name: 'Pilot accounts', conditions: [{ type: 'unit_id', customID: 'companyID', operator: 'any', targetValue: ['acct_1001', 'acct_1002', 'acct_1003'] }] }],
      },
      {
        id: 'enterprise_sso',
        description: 'SSO login for enterprise accounts (companyID segment).',
        owner: P.alice,
        idType: 'companyID',
        tags: ['platform'],
        rules: [{ name: 'Enterprise accounts', conditions: [{ type: 'passes_segment', targetValue: 'enterprise_accounts' }] }],
      },
      {
        id: 'block_fraudulent_checkout',
        description: 'Allow checkout unless on the fraud blocklist (20k ID list → big segment).',
        owner: P.bob,
        tags: ['checkout'],
        rules: [{ name: 'Not on blocklist', conditions: [{ type: 'fails_segment', targetValue: 'fraud_blocklist' }] }],
      },
      {
        id: 'vip_early_access',
        description: 'Early access for VIP customers (small ID list).',
        owner: P.marco,
        tags: ['growth'],
        rules: [{ name: 'VIPs', conditions: [{ type: 'passes_segment', targetValue: 'vip_customers' }] }],
      },
      {
        id: 'wholesale_portal',
        description: 'Wholesale portal for partner accounts (2.5k-ID list; hashed in the config spec).',
        owner: P.bob,
        tags: ['checkout'],
        rules: [{ name: 'Partners', conditions: [{ type: 'passes_segment', targetValue: 'wholesale_partners' }] }],
      },
      // --- Numeric, date, regex, null, array operators ---------------------------------------
      {
        id: 'gift_card_upsell',
        description: 'Numeric comparisons on custom fields.',
        owner: P.marco,
        tags: ['growth'],
        rules: [
          { name: 'Low balance', conditions: [{ type: 'custom_field', field: 'gift_card_balance', operator: 'gt', targetValue: 0 }, { type: 'custom_field', field: 'gift_card_balance', operator: 'lte', targetValue: 25 }] },
          { name: 'Gold tier', conditions: [{ type: 'custom_field', field: 'loyalty_points', operator: 'gte', targetValue: 5000 }, { type: 'custom_field', field: 'loyalty_points', operator: 'lt', targetValue: 20000 }] },
        ],
      },
      {
        id: 'new_customer_onboarding',
        description: 'Date comparisons on signup date (after / on).',
        owner: P.marco,
        tags: ['growth'],
        rules: [
          { name: 'Signed up after launch', conditions: [{ type: 'custom_field', field: 'signup_date', operator: 'after', targetValue: LAUNCH_DAY }] },
          { name: 'Launch-day cohort', conditions: [{ type: 'custom_field', field: 'signup_date', operator: 'on', targetValue: LAUNCH_DAY }] },
        ],
      },
      {
        id: 'sku_preview',
        description: 'Regex on SKU. Rule 2 uses a lookbehind (not portable across SDK regex engines).',
        owner: P.priya,
        tags: ['search'],
        rules: [
          { name: 'Portable regex', conditions: [{ type: 'custom_field', field: 'sku', operator: 'str_matches', targetValue: '^ACME-[0-9]{4}$' }] },
          { name: 'Lookbehind regex', conditions: [{ type: 'custom_field', field: 'sku', operator: 'str_matches', targetValue: '(?<=ACME-)9[0-9]{3}' }] },
        ],
      },
      {
        id: 'missing_email_prompt',
        description: 'Prompt guests with no email to sign in (is_null).',
        owner: P.marco,
        tags: ['growth'],
        rules: [{ name: 'No email', conditions: [{ type: 'email', operator: 'is_null' }] }],
      },
      {
        id: 'sms_notifications',
        description: 'SMS opt-in for users with a phone number (is_not_null).',
        owner: P.marco,
        tags: ['growth'],
        rules: [{ name: 'Has phone', conditions: [{ type: 'custom_field', field: 'phone', operator: 'is_not_null' }] }],
      },
      {
        id: 'wishlist_sharing',
        description: 'Array operators: contains any / contains none.',
        owner: P.priya,
        tags: ['search'],
        rules: [
          {
            name: 'Fashion or home, not kids',
            conditions: [
              { type: 'custom_field', field: 'interests', operator: 'array_contains_any', targetValue: ['fashion', 'home'] },
              { type: 'custom_field', field: 'interests', operator: 'array_contains_none', targetValue: ['kids'] },
            ],
          },
        ],
      },
      {
        id: 'bundle_recommendations',
        description: 'Array operators: contains all / not contains all.',
        owner: P.priya,
        tags: ['search'],
        rules: [
          { name: 'Gamers', conditions: [{ type: 'custom_field', field: 'interests', operator: 'array_contains_all', targetValue: ['gaming', 'electronics'] }] },
          { name: 'Not full-house', conditions: [{ type: 'custom_field', field: 'interests', operator: 'not_array_contains_all', targetValue: ['fashion', 'home', 'garden'] }] },
        ],
      },
      // --- MANUAL condition types --------------------------------------------------------------
      {
        id: 'storefront_url_banner',
        description: 'Banner on specific URLs (url condition: no LD equivalent).',
        owner: P.marco,
        tags: ['growth'],
        targetApps: ['storefront-client-only'],
        rules: [{ name: 'Sale pages', conditions: [{ type: 'url', operator: 'str_contains_any', targetValue: ['/sale', '/deals'] }] }],
      },
      {
        id: 'storefront_app_only',
        description: 'Only for the storefront web target app (target_app condition).',
        owner: P.sam,
        tags: ['platform'],
        targetApps: ['storefront-web'],
        rules: [{ name: 'Storefront', conditions: [{ type: 'target_app', operator: 'any', targetValue: ['storefront-web'] }] }],
      },
      // --- Lifecycle: disabled, archived, stale ----------------------------------------------
      {
        id: 'old_cart_drawer',
        description: 'Old cart drawer. Disabled.',
        owner: P.former,
        tags: ['checkout'],
        isEnabled: false,
        status: 'Disabled',
        rules: [{ name: 'Everyone', conditions: [{ type: 'public' }] }],
        checksPerHour: 0,
      },
      {
        id: 'legacy_wishlist',
        description: 'Replaced by wishlist_sharing. Archived.',
        owner: P.former,
        tags: ['search'],
        status: 'Archived',
        isEnabled: false,
        archivedDaysAgo: 45,
        archiveReason: 'Replaced by wishlist_sharing',
        rules: [{ name: 'Everyone', conditions: [{ type: 'public' }] }],
        checksPerHour: 0,
      },
      {
        id: 'stale_promo_ribbon',
        description: 'Fully launched months ago; StatSig marks it stale (all true). Hard-code instead of migrating.',
        owner: P.marco,
        tags: ['growth'],
        status: 'Launched',
        type: 'STALE',
        typeReason: 'STALE_ALL_TRUE',
        modifiedDaysAgo: 210,
        rules: [{ name: 'Everyone', conditions: [{ type: 'public' }] }],
      },
      {
        id: 'stale_reviews_widget',
        description: 'Nobody checks this gate any more.',
        owner: P.former,
        tags: ['search'],
        type: 'STALE',
        typeReason: 'STALE_PROBABLY_DEAD_CHECK',
        modifiedDaysAgo: 400,
        checksPerHour: 0,
        rules: [{ name: 'Staff', conditions: [STAFF_EMAIL] }],
      },
    ],
    configs: [
      {
        id: 'checkout_config',
        description: 'Checkout tunables, schema-validated.',
        owner: P.bob,
        tags: ['checkout'],
        defaultValue: { max_items: 50, express_enabled: false, payment_providers: ['card'] },
        schema: {
          type: 'object',
          properties: { max_items: { type: 'number' }, express_enabled: { type: 'boolean' }, payment_providers: { type: 'array', items: { type: 'string' } } },
          required: ['max_items'],
        },
        rules: [
          { name: 'Staff', conditions: [STAFF_EMAIL], returnValue: { max_items: 500, express_enabled: true, payment_providers: ['card', 'paypal', 'apple_pay'] } },
          { name: 'US', conditions: [{ type: 'country', operator: 'any', targetValue: ['US'] }], returnValue: { max_items: 100, express_enabled: true, payment_providers: ['card', 'paypal'] } },
        ],
      },
      {
        id: 'homepage_hero',
        description: 'Homepage hero banner with three creative variants.',
        owner: P.marco,
        tags: ['growth'],
        defaultValue: { headline: 'Welcome to Acme', image: 'hero-default.jpg' },
        rules: [
          {
            name: 'Everyone (variants)',
            conditions: [{ type: 'public' }],
            returnValue: { headline: 'Welcome to Acme', image: 'hero-default.jpg' },
            variants: [
              { name: 'Autumn', passPercentage: 50, returnValue: { headline: 'Fall into savings', image: 'hero-autumn.jpg' } },
              { name: 'Minimal', passPercentage: 30, returnValue: { headline: 'Acme.', image: 'hero-minimal.jpg' } },
              { name: 'Video', passPercentage: 20, returnValue: { headline: 'See it in action', image: 'hero-video.mp4' } },
            ],
          },
        ],
      },
      {
        id: 'shipping_thresholds',
        description: 'Free-shipping thresholds by country. Gains a new value in snapshot 2.',
        owner: P.bob,
        tags: ['checkout'],
        defaultValue: { free_shipping_min: 50, currency: 'USD' },
        rules: [
          { name: 'UK', conditions: [{ type: 'country', operator: 'any', targetValue: ['GB'] }], returnValue: { free_shipping_min: 40, currency: 'GBP' } },
          { name: 'Canada', conditions: [{ type: 'country', operator: 'any', targetValue: ['CA'] }], returnValue: { free_shipping_min: 75, currency: 'CAD' } },
        ],
      },
      {
        id: 'search_ranking_weights',
        description: 'Ranking weights; staging gets an experimental mix.',
        owner: P.priya,
        tags: ['search'],
        defaultValue: { text: 0.6, popularity: 0.3, recency: 0.1 },
        rules: [{ name: 'Staging mix', environments: ['staging'], conditions: [{ type: 'public' }], returnValue: { text: 0.4, popularity: 0.4, recency: 0.2 } }],
      },
      {
        id: 'b2b_order_limits',
        description: 'Per-account order limits (companyID).',
        owner: P.bob,
        idType: 'companyID',
        tags: ['checkout'],
        defaultValue: { max_order_value: 10000 },
        rules: [{ name: 'Enterprise accounts', conditions: [{ type: 'passes_segment', targetValue: 'enterprise_accounts' }], returnValue: { max_order_value: 250000 } }],
      },
      {
        id: 'api_rate_limits',
        description: 'Storefront API rate limits; 50% rollout of the new limits.',
        owner: P.sam,
        tags: ['platform'],
        defaultValue: { rps: 50 },
        rules: [{ name: 'New limits (50%)', passPercentage: 50, conditions: [{ type: 'public' }], returnValue: { rps: 80 } }],
      },
    ],
    segments: [
      {
        id: 'beta_testers',
        type: 'rule_based',
        description: 'Customers who opted in to beta features.',
        owner: P.marco,
        rules: [
          { name: 'Opted in', conditions: [{ type: 'custom_field', field: 'beta_opt_in', operator: 'any', targetValue: ['true'] }] },
          { name: 'Staff', conditions: [STAFF_EMAIL] },
        ],
      },
      {
        id: 'enterprise_accounts',
        type: 'rule_based',
        idType: 'companyID',
        description: 'B2B accounts on the enterprise plan.',
        owner: P.bob,
        rules: [{ name: 'Enterprise plan', conditions: [{ type: 'custom_field', field: 'account_plan', operator: 'any', targetValue: ['enterprise'] }] }],
      },
      {
        id: 'vip_customers',
        type: 'id_list',
        description: 'Hand-picked VIP customers.',
        owner: P.marco,
        idList: { pattern: 'vip-{n}', count: 25, pad: 3 },
      },
      {
        id: 'wholesale_partners',
        type: 'id_list',
        description: 'Wholesale partner logins. Large enough to be hashed in the config spec.',
        owner: P.bob,
        idList: { pattern: 'partner-{n}', count: 2500, pad: 5 },
      },
      {
        id: 'fraud_blocklist',
        type: 'id_list',
        description: 'Users blocked by the fraud team. 20k IDs → LD big segment.',
        owner: P.sam,
        idList: { pattern: 'fraud-user-{n}', count: 20000, pad: 6 },
      },
    ],
    experiments: [
      {
        id: 'checkout_button_color',
        description: 'Green vs blue Place Order button.',
        hypothesis: 'A green button increases checkout conversion.',
        owner: P.bob,
        tags: ['checkout'],
        status: 'setup',
        allocation: 100,
        layerID: 'checkout_button_color_layer',
        groups: [
          { name: 'Control', size: 50, parameterValues: { color: 'blue' } },
          { name: 'Green', size: 50, parameterValues: { color: 'green' } },
        ],
        primaryMetrics: [{ name: 'checkout_conversion', type: 'ratio' }],
      },
      {
        id: 'search_ranking_v3',
        description: 'New ranking model, US only via a targeting gate.',
        hypothesis: 'Model v3 increases add-to-cart from search.',
        owner: P.priya,
        tags: ['search'],
        status: 'active',
        allocation: 50,
        targetingGateID: 'checkout_targeting_gate',
        groups: [
          { name: 'Control', size: 50, parameterValues: { model: 'v2' } },
          { name: 'Model v3', size: 50, parameterValues: { model: 'v3' } },
        ],
        primaryMetrics: [{ name: 'purchase_count', type: 'event_count_custom' }],
        secondaryMetrics: [{ name: 'revenue', type: 'sum' }],
        startedDaysAgo: 9,
      },
      {
        id: 'homepage_layout_test',
        description: 'Grid vs list layout on the homepage. Shipped Grid.',
        hypothesis: 'Grid layout increases product clicks.',
        owner: P.marco,
        tags: ['growth'],
        status: 'decision_made',
        allocation: 100,
        launchedGroup: 'Grid',
        groups: [
          { name: 'Control', size: 50, parameterValues: { layout: 'list', columns: 1 } },
          { name: 'Grid', size: 50, parameterValues: { layout: 'grid', columns: 4 } },
        ],
        primaryMetrics: [{ name: 'checkout_conversion', type: 'ratio' }],
        startedDaysAgo: 60,
        endedDaysAgo: 20,
        decisionReason: 'Grid won on conversion (+3.1%).',
      },
      {
        id: 'free_shipping_banner',
        description: 'Free shipping banner copy test. Abandoned.',
        hypothesis: 'A banner increases AOV.',
        owner: P.marco,
        tags: ['growth'],
        status: 'abandoned',
        allocation: 100,
        groups: [
          { name: 'Control', size: 50, parameterValues: { show_banner: false } },
          { name: 'Banner', size: 50, parameterValues: { show_banner: true } },
        ],
        startedDaysAgo: 40,
        endedDaysAgo: 35,
        decisionReason: 'Instrumentation bug.',
      },
      {
        id: 'checkout_cta_copy',
        description: 'CTA copy test in the checkout layer.',
        hypothesis: 'Urgent copy increases conversion.',
        owner: P.bob,
        tags: ['checkout'],
        status: 'active',
        allocation: 40,
        layerID: 'checkout_layer',
        groups: [
          { name: 'Control', size: 50, parameterValues: { cta_text: 'Place order' } },
          { name: 'Urgent', size: 50, parameterValues: { cta_text: 'Complete purchase now' } },
        ],
        primaryMetrics: [{ name: 'checkout_conversion', type: 'ratio' }],
        startedDaysAgo: 5,
      },
      {
        id: 'checkout_trust_badges',
        description: 'Trust badges test in the checkout layer.',
        hypothesis: 'Badges reduce cart abandonment.',
        owner: P.bob,
        tags: ['checkout'],
        status: 'setup',
        allocation: 30,
        layerID: 'checkout_layer',
        groups: [
          { name: 'Control', size: 50, parameterValues: { show_badges: false } },
          { name: 'Badges', size: 50, parameterValues: { show_badges: true } },
        ],
      },
    ],
    layers: [
      {
        id: 'checkout_layer',
        description: 'Mutually exclusive checkout experiments sharing CTA parameters.',
        owner: P.bob,
        parameters: [
          { name: 'cta_text', type: 'string', defaultValue: 'Place order' },
          { name: 'show_badges', type: 'boolean', defaultValue: false },
        ],
        experimentIds: ['checkout_cta_copy', 'checkout_trust_badges'],
      },
      {
        id: 'checkout_button_color_layer',
        description: 'Implicit layer created for checkout_button_color.',
        owner: P.bob,
        isImplicitLayer: true,
        parameters: [{ name: 'color', type: 'string', defaultValue: 'blue' }],
        experimentIds: ['checkout_button_color'],
      },
    ],
    holdouts: [
      { id: 'global_holdout', description: 'Global 2% holdout for measuring cumulative impact.', owner: P.alice, passPercentage: 2, isGlobal: true },
      { id: 'checkout_holdout', description: 'Holdout for checkout gates.', owner: P.bob, passPercentage: 5, gateIDs: ['new_checkout_flow'] },
    ],
    autotunes: [
      {
        id: 'promo_banner_autotune',
        description: 'Bandit over promo banner copy.',
        owner: P.marco,
        successEvent: 'promo_click',
        isStarted: true,
        variants: [
          { name: 'Ten off', json: { copy: '10% off today' } },
          { name: 'Free ship', json: { copy: 'Free shipping on everything' } },
          { name: 'BOGO', json: { copy: 'Buy one get one' } },
        ],
      },
    ],
    metrics: [
      { name: 'purchase_count', type: 'event_count_custom', description: 'Count of purchase events.', owner: P.marco, events: ['purchase'] },
      { name: 'revenue', type: 'sum', description: 'Sum of purchase value.', owner: P.marco, events: ['purchase'] },
      { name: 'avg_order_value', type: 'mean', description: 'Mean purchase value.', owner: P.marco, events: ['purchase'] },
      { name: 'checkout_conversion', type: 'ratio', description: 'Purchases / checkout starts.', owner: P.bob, events: ['purchase', 'checkout_start'] },
      { name: 'checkout_funnel', type: 'funnel', description: 'View cart → checkout → purchase.', owner: P.bob, funnel: ['view_cart', 'checkout_start', 'purchase'] },
      {
        name: 'engagement_score',
        type: 'composite',
        description: 'Composite of clicks and purchases (no LD equivalent).',
        owner: P.marco,
        components: [{ name: 'purchase_count', type: 'event_count_custom' }, { name: 'promo_clicks', type: 'event_count_custom' }],
      },
      { name: 'promo_clicks', type: 'event_count_custom', description: 'Promo banner clicks.', owner: P.marco, events: ['promo_click'] },
    ],
    metricSources: [],
    paramStores: [
      {
        name: 'checkout_params',
        description: 'Checkout parameters for the storefront.',
        owner: P.bob,
        parameters: [
          { ref_type: 'static', name: 'support_phone', param_type: 'string', value: '+1-800-555-0100' },
          { ref_type: 'gate', name: 'express_pay_enabled', gate_name: 'checkout_express_pay', param_type: 'boolean', pass_value: true, fail_value: false },
          { ref_type: 'experiment', name: 'cta_text', param_type: 'string', experiment_name: 'checkout_cta_copy', param_name: 'cta_text' },
          { ref_type: 'dynamic_config', name: 'max_items', param_type: 'number', config_name: 'checkout_config', param_name: 'max_items' },
        ],
      },
    ],
    gateOverrides: [
      {
        gate: 'new_checkout_flow',
        passingUserIDs: ['user-qa-1', 'user-qa-2'],
        failingUserIDs: ['user-vip-complainer'],
        environmentOverrides: [{ environment: 'staging', unitID: 'userID', passingIDs: ['user-staging-tester'], failingIDs: [] }],
      },
      {
        gate: 'b2b_bulk_ordering',
        passingCustomIDs: ['acct_2001'],
        environmentOverrides: [{ environment: 'production', unitID: 'companyID', passingIDs: ['acct_9999'], failingIDs: ['acct_1003'] }],
      },
    ],
    experimentOverrides: [
      { experiment: 'search_ranking_v3', userIDOverrides: [{ groupName: 'Model v3', ids: ['user-search-qa'] }] },
    ],
  };
}
