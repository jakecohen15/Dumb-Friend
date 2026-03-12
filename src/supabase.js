import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qxcgdgftxvglywqyofkj.supabase.co'
const supabaseAnonKey = 'sb_publishable_SuxsuVeHkuLz8tP3zc3k2A_zzCxYAzW'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})
