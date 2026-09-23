const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
    const email = (process.argv[2] || "admin@example.com").trim().toLowerCase();
    const password = process.argv[3] || "admin123";

    const existingUser = await prisma.user.findUnique({
        where: { email }
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUser) {
        console.log(`User ${email} found. Updating to SUPERADMIN and setting password...`);
        await prisma.user.update({
            where: { email },
            data: { 
                role: 'SUPERADMIN',
                password: hashedPassword
            }
        });
        console.log("User updated successfully!");
    } else {
        console.log(`Creating new SUPERADMIN user ${email}...`);
        await prisma.user.create({
            data: {
                email,
                name: "Super Admin",
                password: hashedPassword,
                role: 'SUPERADMIN'
            }
        });
        console.log("Super Admin created successfully!");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
