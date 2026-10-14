// Public configuration only. The publishable key can call ff_form_context, ff_submit_nomination
// and ff_upload_ticket (all check the issue link on the server), and can only add photos to the
// private ff-submissions store under a valid upload ticket. It can't read anything back.
window.FF_CONFIG = {
  supabaseUrl: "https://mkejeadhqdadchvytkhq.supabase.co",
  publishableKey: "sb_publishable_TpKkwSyuS6fNxBO3tDYDOg_aTELChjq"
};
