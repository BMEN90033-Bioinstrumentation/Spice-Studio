*
*Zetex ZXMN3A02X8 Spice Model v2.0 Last Revised 22/2/05
*
*
.SUBCKT ZXMN3A02X8 30 40 50
*----connections----D-G-S
M1 6 2 7 7 Nmod
M2 7 2 7 6 Pmod
RG 4 2 3
RIN 2 5 1E12
RD 3 6 Rdmod 0.001
RS 7 5 Rdmod 0.018
RL 3 5 3E9
C1 2 5 8.5E-12
C2 3 2 3E-12
D1 5 3  Dbodymod
LD 3 30 1.5E-9
LG 4 40 1.0E-9
LS 5 50 1.0E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=5.5E-8 NSUB=1E17 L=1.16E-6 W=2.3  VTO=2
+KP=5E-5 NFS=2E11 KAPPA=0.1 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=5.5E-8 NSUB=1.5E16 L=1.3E-6 W=1.3  
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=4E-12 RS=.014 IKF=3.6 TRS1=1.5e-3
+CJO=1070e-12  BV=33)
.MODEL Rdmod RES (TC1=4e-3 TC2=1E-5)
.ENDS
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
