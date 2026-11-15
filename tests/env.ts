// Every test process talks to a throwaway database, never data/elections.db.
process.env.DATABASE_URL = "file:../data/test.db";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.BASE_URL = "http://localhost:3220";
process.env.UPLOAD_DIR = "./data/test-uploads";
process.env.IPLIST_DIR = "./data/test-iplists";
